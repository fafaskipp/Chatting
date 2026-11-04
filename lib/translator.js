'use strict';
// 日本語の記録・予定を、裏でインドネシア語・シンハラ語に自動翻訳する係。
// 翻訳そのものは translator/translate_server.py（オフライン）。入っていなければ何もしない。
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const TARGETS = ['id', 'en'];

function createTranslator({ store, rootDir, log = console.log }) {
  const dir = path.join(rootDir, 'translator');
  const modelDir = path.join(dir, 'model');
  const port = Number(process.env.TRANSLATOR_PORT) || 5005;
  const external = process.env.TRANSLATOR_URL || '';
  const fake = process.env.TRANSLATOR_FAKE === '1';
  const venvPython = path.join(dir, 'venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');

  const installed = process.env.KAIGO_TRANSLATE !== 'off' && (Boolean(external) || fake || fs.existsSync(modelDir));
  let state = installed ? 'starting' : 'off'; // off / starting / ready
  let child = null;
  let busy = false;
  let restarts = 0;

  function request(method, urlPath, body, timeout) {
    return new Promise((resolve, reject) => {
      const base = external ? new URL(external) : { hostname: '127.0.0.1', port };
      const data = body ? Buffer.from(JSON.stringify(body)) : null;
      const req = http.request(
        {
          hostname: base.hostname,
          port: base.port || port,
          path: urlPath,
          method,
          timeout,
          headers: data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {},
        },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            try {
              const obj = JSON.parse(Buffer.concat(chunks).toString('utf8'));
              res.statusCode === 200 ? resolve(obj) : reject(new Error(obj.error || 'http ' + res.statusCode));
            } catch (e) {
              reject(e);
            }
          });
        }
      );
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', reject);
      if (data) req.write(data);
      req.end();
    });
  }

  function startChild() {
    if (external || child) return;
    const py = process.env.KAIGO_PYTHON || (fs.existsSync(venvPython) ? venvPython : '');
    if (!py && !fake) {
      log('  [翻訳] translator/venv がありません。translator\\setup-translator.bat を先に実行してください。');
      return;
    }
    const args = [path.join(dir, 'translate_server.py'), '--port', String(port)];
    if (fake) args.push('--fake');
    else args.push('--model', modelDir);
    child = spawn(py || 'python3', args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    child.stdout.on('data', (d) => process.stdout.write('  [翻訳] ' + d));
    child.stderr.on('data', (d) => {
      const s = String(d).trim();
      if (s) process.stdout.write('  [翻訳] ' + s.split('\n').slice(-3).join(' / ') + '\n');
    });
    child.on('error', (e) => log('  [翻訳] 起動できませんでした: ' + e.message));
    child.on('exit', (code) => {
      child = null;
      state = 'starting';
      if (restarts++ < 5) setTimeout(startChild, 15000);
      else log('  [翻訳] 翻訳サービスが止まりました（code ' + code + '）。自動翻訳なしで続けます。');
    });
  }

  async function healthy() {
    try {
      await request('GET', '/health', null, 1500);
      return true;
    } catch {
      return false;
    }
  }

  async function translateItem({ kind, item, fields }) {
    const snapshot = {};
    for (const f of fields) snapshot[f] = item[f] || '';
    const texts = fields.map((f) => snapshot[f]);
    let tr = null;
    try {
      const res = await request('POST', '/translate', { texts, targets: TARGETS }, 180000);
      tr = {};
      for (const lang of TARGETS) {
        tr[lang] = {};
        fields.forEach((f, i) => (tr[lang][f] = (res[lang] && res[lang][i]) || ''));
      }
    } catch (e) {
      if (!(await healthy())) return 'down'; // サービスが落ちている → 待ちのまま、あとでやり直す
      log('  [翻訳] 失敗: ' + kind + ' ' + item.id + ' ' + e.message);
    }
    store.setTr(item, fields, snapshot, tr);
    return tr ? 'ok' : 'failed';
  }

  async function tick() {
    if (!installed || busy) return;
    busy = true;
    try {
      const ok = await healthy();
      if (!ok) {
        state = 'starting';
        return;
      }
      if (state !== 'ready') {
        state = 'ready';
        store.retryTr();
      }
      for (const job of store.pendingTr().slice(0, 5)) {
        if ((await translateItem(job)) === 'down') break;
      }
    } finally {
      busy = false;
    }
  }

  // 翻訳が入る前に書かれた最近の記録も、順に翻訳する（直近60日）
  function backfill() {
    if (!installed) return;
    const limit = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
    let n = 0;
    // 前の版（インドネシア語・シンハラ語）で翻訳したものは、英語を足すために翻訳しなおす
    for (const x of [...store.db.notes, ...store.db.events]) if (x.tr && !x.tr.en && x.trState === 'done') ((x.trState = 'pending'), n++);
    for (const x of store.db.notes) if (!x.deletedAt && x.text && !x.tr && !x.trState && x.date >= limit) ((x.trState = 'pending'), n++);
    for (const x of store.db.events) if (!x.deletedAt && !x.tr && !x.trState && x.date >= limit) ((x.trState = 'pending'), n++);
    if (n) log(`  [翻訳] 以前の記録 ${n} 件を、順番に自動翻訳します`);
  }

  function start() {
    if (!installed) return;
    backfill();
    startChild();
    setInterval(tick, 3000);
  }

  function stop() {
    if (child) child.kill();
  }

  function status() {
    const pending = installed ? store.pendingTr().length : 0;
    return { installed, state, pending };
  }

  return { installed, start, stop, status, tick };
}

module.exports = { createTranslator };
