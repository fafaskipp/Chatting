// 介護日記 8ユニット版 — 1台のサーバーで、ユニットごとに別々の記録を保存する（外部ライブラリ不要）
// 使い方: node server.js  → 表示される http://<IP>:3000 を他のパソコン/スマホのブラウザで開く
// ユニットごとに http://<IP>:3000/u/<ユニットID>/ で開く。ユニットの一覧は units.json

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { createStore, localDate } = require('./lib/store');
const { createTranslator } = require('./lib/translator');
const { createAuth } = require('./lib/auth');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const UNITS_FILE = process.env.UNITS_FILE || path.join(ROOT, 'units.json');
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024; // 100MB（短い動画まで）
const TRASH_DAYS = 30; // ゴミ箱はこの日数で自動的に完全削除
const MAX_JSON_BYTES = 1024 * 1024;
const SLOT_COUNT = Number(process.env.SLOTS) || 10; // 利用者の枠の数

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.m4v': 'video/x-m4v',
  '.3gp': 'video/3gpp',
};
const UPLOAD_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.heic', '.mp4', '.mov', '.webm', '.m4v', '.3gp']);

// ---------- ユニット（units.json） ----------

function loadUnitConfigs() {
  const list = JSON.parse(fs.readFileSync(UNITS_FILE, 'utf8'));
  const seen = new Set();
  return list.map((u) => {
    if (!u || !/^[a-z0-9_-]{1,32}$/.test(u.id || '')) throw new Error(`units.json: id が正しくありません (${JSON.stringify(u && u.id)}) — 半角の英数字・- _ だけ`);
    if (seen.has(u.id)) throw new Error(`units.json: id が重なっています (${u.id})`);
    seen.add(u.id);
    return { id: u.id, name: String(u.name || u.id).slice(0, 40), color: u.color || '#1565c0', shape: u.shape || 'round' };
  });
}

// ---------- ユニットごとのデータベース（JSON ファイル） ----------

const translatorInstalled =
  process.env.KAIGO_TRANSLATE !== 'off' &&
  (Boolean(process.env.TRANSLATOR_URL) || process.env.TRANSLATOR_FAKE === '1' || fs.existsSync(path.join(__dirname, 'translator', 'model', 'model.bin')));

// db.json が壊れていたら、いちばん新しいバックアップから読み込む（壊れたファイルは名前を変えて残す）
function loadDb(dbFile, backupDir, label) {
  if (!fs.existsSync(dbFile)) return {};
  try {
    return JSON.parse(fs.readFileSync(dbFile, 'utf8'));
  } catch (err) {
    const broken = `${dbFile}.broken-${Date.now()}`;
    fs.renameSync(dbFile, broken);
    console.log(`  [!] ${label}: db.json rusak dan disimpan sebagai ${path.basename(broken)}.`);
    const backups = fs.existsSync(backupDir) ? fs.readdirSync(backupDir).filter((f) => f.startsWith('db-')).sort().reverse() : [];
    for (const f of backups) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(backupDir, f), 'utf8'));
        console.log(`      Data dipulihkan dari backup ${f}.`);
        fs.copyFileSync(path.join(backupDir, f), dbFile);
        return data;
      } catch {}
    }
    console.log('      Tidak ada backup yang bisa dipakai. Mulai dengan data kosong.');
    return {};
  }
}

// 1ユニット分の「記録の入れ物」：自分だけのフォルダ（data/units/<id>/）に、db.json・写真・バックアップを持つ
function createUnit(cfg) {
  const dir = path.join(DATA_DIR, 'units', cfg.id);
  const uploadDir = path.join(dir, 'uploads');
  const dbFile = path.join(dir, 'db.json');
  const backupDir = path.join(dir, 'backups');
  fs.mkdirSync(uploadDir, { recursive: true });
  fs.mkdirSync(backupDir, { recursive: true });

  const unit = { id: cfg.id, cfg, dir, uploadDir };
  unit.store = createStore({
    db: loadDb(dbFile, backupDir, cfg.id),
    translate: translatorInstalled,
    slotCount: SLOT_COUNT,
    trashDays: TRASH_DAYS,
    newId,
    unitId: cfg.id,
    unitExists: (id) => id !== cfg.id && units.has(id),
    mediaExists: (file) => fs.existsSync(path.join(uploadDir, path.basename(file))),
    removeMedia: (file) => fs.unlink(path.join(uploadDir, path.basename(file)), () => {}),
    onChange: () => {
      saveDb();
      dailyBackup();
    },
  });

  // 書き込みは一時ファイル→リネームで、途中で電源が切れても壊れにくくする
  // 同時に何人が保存しても、Node は1件ずつ順番に処理するので記録は失われない
  function saveDb() {
    const tmp = dbFile + '.tmp';
    const data = JSON.stringify(unit.store.db);
    fs.writeFileSync(tmp, data);
    try {
      fs.renameSync(tmp, dbFile);
    } catch {
      // Windows でウイルス対策ソフトがファイルを開いているときなど
      fs.writeFileSync(dbFile, data);
      fs.rmSync(tmp, { force: true });
    }
  }

  // 1日1回、起動時と書き込み時に自動バックアップ（直近30日分を保持）
  function dailyBackup() {
    if (!fs.existsSync(dbFile)) return;
    const target = path.join(backupDir, `db-${localDate()}.json`);
    if (fs.existsSync(target)) return;
    fs.copyFileSync(dbFile, target);
    const old = fs.readdirSync(backupDir).filter((f) => f.startsWith('db-')).sort().slice(0, -30);
    for (const f of old) fs.unlinkSync(path.join(backupDir, f));
  }

  // 入力画面で写真を追加して「やめる」と、どの記録にも使われない写真が残るので、1日たったら消す
  function removeOrphanUploads() {
    const used = new Set(unit.store.db.notes.flatMap((n) => n.media.map((m) => m.file)));
    const dayAgo = Date.now() - 86400000;
    for (const f of fs.readdirSync(uploadDir)) {
      if (used.has(f)) continue;
      const full = path.join(uploadDir, f);
      try {
        if (fs.statSync(full).mtimeMs < dayAgo) fs.unlinkSync(full);
      } catch {}
    }
  }

  unit.housekeeping = () => {
    try {
      unit.store.purgeExpiredTrash();
      removeOrphanUploads();
    } catch (err) {
      console.error(err);
    }
  };

  // 画面の上の名前は、はじめは units.json の名前。あとから「⚙️ 管理」で変えられる
  if (!unit.store.db.settings.unitName) unit.store.db.settings.unitName = cfg.name;
  dailyBackup();
  return unit;
}

const units = new Map(); // id -> unit（下の起動のところで入れる）

function newId() {
  return crypto.randomBytes(8).toString('hex');
}


// ---------- HTTP ヘルパー ----------

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
  res.end(data);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_JSON_BYTES) {
        reject(Object.assign(new Error('データが大きすぎます'), { status: 413, code: 'tooLarge' }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(Object.assign(new Error('データの形式が正しくありません'), { status: 400, code: 'badJson' }));
      }
    });
    req.on('error', reject);
  });
}

// ファイルが途中で消えても、サーバー全体が止まらないようにする
function pipeFile(stream, res) {
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

function serveFile(req, res, filePath, extraHeaders = {}) {
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) return sendJson(res, 404, { error: '見つかりません', code: 'notFound' });
    const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    const range = req.headers.range;
    // 動画の再生位置移動のために Range に対応
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      let start = m && m[1] ? parseInt(m[1], 10) : 0;
      let end = m && m[2] ? parseInt(m[2], 10) : stat.size - 1;
      if (m && !m[1] && m[2]) {
        start = Math.max(0, stat.size - parseInt(m[2], 10));
        end = stat.size - 1;
      }
      if (start >= stat.size || end >= stat.size || start > end) {
        res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
        return res.end();
      }
      res.writeHead(206, {
        'Content-Type': type,
        'Content-Length': end - start + 1,
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        ...extraHeaders,
      });
      return pipeFile(fs.createReadStream(filePath, { start, end }), res);
    }
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': stat.size, 'Accept-Ranges': 'bytes', ...extraHeaders });
    pipeFile(fs.createReadStream(filePath), res);
  });
}

// ---------- API ----------

// apiPath は、ユニットの名前を取りのぞいた '/api/notes/..' の形
async function handleApi(req, res, url, unit, apiPath) {
  const { store, uploadDir } = unit;
  const parts = apiPath.split('/').filter(Boolean); // ['api', 'notes', id?, action?]
  const me = req.me;
  // だれが何をしてよいかは、画面ではなくここ（サーバー）で決める
  const perms = auth.authorize(me, unit.id, req.method, parts, store);
  const resource = parts[1];
  const method = req.method;

  if (resource === 'info' && method === 'GET') {
    return sendJson(res, 200, { addresses: lanAddresses(), port: PORT, slots: SLOT_COUNT, trashDays: TRASH_DAYS, translator: translator.status(), unit: { id: unit.id, name: unit.cfg.name }, me, perms });
  }

  // 写真・動画のアップロード（本文はファイルそのもの）
  if (resource === 'upload' && method === 'POST') {
    const original = decodeURIComponent(String(req.headers['x-filename'] || 'file'));
    let ext = path.extname(original).toLowerCase();
    if (!UPLOAD_EXT.has(ext)) return sendJson(res, 400, { error: 'この種類のファイルは使えません（写真か動画を選んでください）', code: 'badFileType' });
    if (ext === '.jpeg') ext = '.jpg';
    const length = Number(req.headers['content-length'] || 0);
    if (length > MAX_UPLOAD_BYTES) return sendJson(res, 413, { error: 'ファイルが大きすぎます（100MBまで）', code: 'fileTooBig' });
    const file = `${Date.now()}-${newId()}${ext}`;
    const target = path.join(uploadDir, file);
    const out = fs.createWriteStream(target);
    let size = 0;
    let failed = false;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_UPLOAD_BYTES && !failed) {
        failed = true;
        req.unpipe(out);
        out.destroy();
        fs.unlink(target, () => {});
        sendJson(res, 413, { error: 'ファイルが大きすぎます（100MBまで）', code: 'fileTooBig' });
      }
    });
    // 途中で通信が切れたら、書きかけのファイルを消す
    req.on('aborted', () => {
      failed = true;
      out.destroy();
      fs.unlink(target, () => {});
    });
    req.pipe(out);
    out.on('finish', () => {
      if (failed) return;
      const type = ['.mp4', '.mov', '.webm', '.m4v', '.3gp'].includes(ext) ? 'video' : 'image';
      sendJson(res, 201, { file, type });
    });
    out.on('error', () => {
      if (!failed) sendJson(res, 500, { error: '保存に失敗しました', code: 'saveFailed' });
    });
    return;
  }

  const body = method === 'POST' || method === 'PUT' ? await readJson(req) : {};
  // ほかのユニットが書きたす記録：書いた人は自動でそのユニットの名前（例：かきの木）
  if (perms.addOnly && parts[1] === 'notes') body.author = me.name;
  return sendJson(res, 200, store.handle(method, apiPath, url.searchParams, body, { by: me.id }));
}

// ---------- サーバー ----------

// 全ユニットの名前と、きょうの記録の数（ユニットえらびの画面で使う）
function unitList() {
  const today = localDate();
  return [...units.values()].map((u) => {
    const notes = u.store.db.notes.filter((n) => !n.deletedAt && n.date === today);
    return {
      id: u.id,
      name: u.store.db.settings.unitName || u.cfg.name,
      color: u.cfg.color,
      shape: u.cfg.shape,
      today: notes.length,
      important: notes.filter((n) => n.important).length,
    };
  });
}

// 看護師・ケアマネジャーのホームに出す「この1週間の大事なこと」：全ユニットの、直近7日の重要な記録とヒヤリ・事故
// 朝はまだ記録が少なく、休みの次の日でも1週間分を1ページで読めるように、今日・昨日…の順に返す
const OVERVIEW_DAYS = 7;
function overview(me) {
  if (me.role === 'unit') throw Object.assign(new Error('この操作はできません'), { status: 403, code: 'staffOnly' });
  const days = [];
  for (let i = 0; i < OVERVIEW_DAYS; i++) days.push(localDate(new Date(Date.now() - i * 86400000)));
  const from = days[days.length - 1];
  const out = [];
  for (const u of units.values()) {
    const name = u.store.db.settings.unitName || u.cfg.name;
    for (const n of u.store.db.notes) {
      if (n.deletedAt || n.date < from || n.date > days[0]) continue;
      const incident = u.store.isIncident(n);
      if (!n.important && !incident) continue;
      const p = n.patientId && u.store.db.patients.find((x) => x.id === n.patientId);
      out.push({ unit: u.id, unitName: name, color: u.cfg.color, id: n.id, date: n.date, time: n.time, category: n.category, important: n.important, incident, patient: p ? p.name : '', author: n.author, text: n.text, tr: n.tr });
    }
  }
  // 新しい日が上。同じ日の中は、新しい時刻が上
  out.sort((a, b) => (b.date + (b.time || '00:00')).localeCompare(a.date + (a.time || '00:00')));
  return { days, items: out };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;

    // ---------- ログイン（だれでも使える入り口） ----------
    if (p === '/api/accounts/public' && req.method === 'GET') {
      const byId = new Map([...units.values()].map((u) => [u.id, u.cfg]));
      return sendJson(res, 200, auth.publicList().map((a) => ({ ...a, color: a.unit && byId.get(a.unit) ? byId.get(a.unit).color : '', shape: a.unit && byId.get(a.unit) ? byId.get(a.unit).shape : '' })));
    }
    if (p === '/api/login' && req.method === 'POST') {
      const body = await readJson(req);
      const r = auth.login(body.id, body.password);
      res.setHeader('Set-Cookie', r.cookie);
      return sendJson(res, 200, { account: r.account, home: r.account.role === 'unit' ? `/u/${r.account.unit}/` : '/' });
    }
    if (p === '/api/logout' && req.method === 'POST') {
      res.setHeader('Set-Cookie', auth.logout(req));
      return sendJson(res, 200, { ok: true });
    }

    // ---------- ここから先は、ログインが必要 ----------
    const me = auth.who(req);
    req.me = me;
    const isApi = p.startsWith('/api/') || /^\/u\/[^/]+\/(api|uploads)\//.test(p);
    // 画面の部品（.js / .css / 辞書）は記録を含まないので、ログイン前でも読める。記録・写真・画面そのものは読めない
    const isAsset = !isApi && /\.(js|css|gz|txt|md|svg|png|ico)$/.test(p) && !p.includes('/uploads/');
    if (!me && !isAsset && p !== '/login.html') {
      if (isApi) return sendJson(res, 401, { error: 'ログインしてください', code: 'unauthorized' });
      res.writeHead(302, { Location: '/login.html', 'Cache-Control': 'no-store' });
      return res.end();
    }
    if (me && p === '/login.html' && !url.searchParams.has('switch')) {
      res.writeHead(302, { Location: me.role === 'unit' ? `/u/${me.unit}/` : '/', 'Cache-Control': 'no-store' });
      return res.end();
    }

    if (p === '/api/me' && req.method === 'GET') return sendJson(res, 200, me);
    if (p === '/api/me/password' && req.method === 'PUT') {
      const body = await readJson(req);
      return sendJson(res, 200, auth.changeOwnPassword(req, me, body.current, body.next));
    }
    if (p === '/api/accounts' && req.method === 'GET') return sendJson(res, 200, auth.adminList(me));
    const am = /^\/api\/accounts\/([a-z0-9_-]+)$/.exec(p);
    if (am && req.method === 'PUT') return sendJson(res, 200, auth.adminUpdate(me, am[1], await readJson(req)));

    // ユニットえらび（ホーム）用
    if (p === '/api/units' && req.method === 'GET') return sendJson(res, 200, unitList());
    if (p === '/api/overview' && req.method === 'GET') return sendJson(res, 200, overview(me));
    // /u/<ユニットID>/...  → そのユニットだけの記録・写真・画面
    const m = /^\/u\/([^/]+)(\/.*)?$/.exec(p);
    if (m) {
      const unit = units.get(decodeURIComponent(m[1]));
      if (!unit) return sendJson(res, 404, { error: '見つかりません', code: 'notFound' });
      const rest = m[2] || '/';
      if (!m[2]) {
        res.writeHead(301, { Location: `/u/${unit.id}/${url.search}` });
        return res.end();
      }
      if (rest.startsWith('/api/')) return await handleApi(req, res, url, unit, rest);
      if (rest.startsWith('/uploads/')) {
        const file = path.basename(decodeURIComponent(rest.slice('/uploads/'.length)));
        return serveFile(req, res, path.join(unit.uploadDir, file), { 'Cache-Control': 'max-age=31536000, immutable' });
      }
      return servePublic(req, res, rest === '/' ? '/index.html' : rest);
    }

    // トップページ＝ユニットえらび
    return servePublic(req, res, p === '/' ? '/launcher.html' : p, true);
  } catch (err) {
    if (!res.headersSent) {
      sendJson(res, err.status || 500, err.status
        ? { error: err.message, code: err.code, params: err.params }
        : { error: 'サーバーでエラーが起きました', code: 'server' });
    }
    if (!err.status) console.error(err);
  }
});

function servePublic(req, res, rel, isRoot) {
  rel = decodeURIComponent(rel);
  // 記録の画面（index.html）はユニットの中でだけ開く
  if (isRoot && rel === '/index.html') {
    res.writeHead(302, { Location: '/' });
    return res.end();
  }
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) return sendJson(res, 403, { error: '禁止されています', code: 'forbidden' });
  const longCache = rel.startsWith('/furigana/dict/');
  return serveFile(req, res, filePath, { 'Cache-Control': longCache ? 'max-age=31536000, immutable' : 'no-cache' });
}

// 家や施設の Wi-Fi でよく使うアドレス（192.168.x.x）を先に出す
function lanAddresses() {
  const rank = (ip) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : 2);
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254.'))
    .map((i) => i.address)
    .sort((a, b) => rank(a) - rank(b));
}

const unitConfigs = loadUnitConfigs();
for (const cfg of unitConfigs) units.set(cfg.id, createUnit(cfg));
const auth = createAuth({ dataDir: DATA_DIR, units: unitConfigs });

const translator = createTranslator({ stores: () => [...units.values()].map((u) => u.store), rootDir: __dirname });
translator.start();
process.on('exit', () => translator.stop());
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

function housekeeping() {
  for (const u of units.values()) u.housekeeping();
}
housekeeping();
setInterval(housekeeping, 60 * 60 * 1000);
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log('');
    console.log(`  [!] Port ${PORT} sudah dipakai. Kemungkinan server Kaigo Nikki sudah berjalan.`);
    console.log(`      Buka saja http://localhost:${PORT} di browser.`);
    console.log('');
    process.exit(1);
  }
  throw err;
});
server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('  介護日記（8ユニット版）サーバーが起動しました');
  console.log('  ───────────────────────────────');
  console.log(`  このパソコン:   http://localhost:${PORT}`);
  for (const ip of lanAddresses()) console.log(`  ほかの端末から: http://${ip}:${PORT}`);
  console.log(`  ユニット: ${[...units.values()].map((u) => u.cfg.name).join('、')}`);
  console.log(`  データの保存先: ${DATA_DIR}`);
  console.log('  終了するときは このウィンドウを閉じてください');
  console.log('');
});
