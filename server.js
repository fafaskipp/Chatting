// 介護日記 — オフラインで動く LAN 共有サーバー（外部ライブラリ不要）
// 使い方: node server.js  → 表示される http://<IP>:3000 を他のパソコン/スマホのブラウザで開く

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const MAX_UPLOAD_BYTES = 500 * 1024 * 1024; // 500MB（動画用）
const MAX_JSON_BYTES = 1024 * 1024;
const MAX_PATIENTS = 50;

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

// ---------- データベース（JSON ファイル） ----------

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(BACKUP_DIR, { recursive: true });

function loadDb() {
  if (!fs.existsSync(DB_FILE)) return { patients: [], notes: [] };
  const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  db.patients = db.patients || [];
  db.notes = db.notes || [];
  return db;
}

let db = loadDb();

// 書き込みは一時ファイル→リネームで、途中で電源が切れても壊れにくくする
function saveDb() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

// 1日1回、起動時と書き込み時に自動バックアップ（直近30日分を保持）
function dailyBackup() {
  if (!fs.existsSync(DB_FILE)) return;
  const name = `db-${localDate()}.json`;
  const target = path.join(BACKUP_DIR, name);
  if (fs.existsSync(target)) return;
  fs.copyFileSync(DB_FILE, target);
  const old = fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith('db-')).sort().slice(0, -30);
  for (const f of old) fs.unlinkSync(path.join(BACKUP_DIR, f));
}

function localDate(d = new Date()) {
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

function newId() {
  return crypto.randomBytes(8).toString('hex');
}

function str(v, max = 200) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
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
        reject(Object.assign(new Error('データが大きすぎます'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(Object.assign(new Error('データの形式が正しくありません'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function serveFile(req, res, filePath, extraHeaders = {}) {
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) return sendJson(res, 404, { error: '見つかりません' });
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
      return fs.createReadStream(filePath, { start, end }).pipe(res);
    }
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': stat.size, 'Accept-Ranges': 'bytes', ...extraHeaders });
    fs.createReadStream(filePath).pipe(res);
  });
}

// ---------- 入力チェック ----------

function cleanPatient(body) {
  const name = str(body.name, 50);
  if (!name) throw Object.assign(new Error('名前を入力してください'), { status: 400 });
  return {
    name,
    kana: str(body.kana, 50),
    room: str(body.room, 20),
    memo: str(body.memo, 1000),
  };
}

function cleanNote(body) {
  const date = str(body.date, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw Object.assign(new Error('日付が正しくありません'), { status: 400 });
  const time = str(body.time, 5);
  const patientId = str(body.patientId, 32) || null;
  if (patientId && !db.patients.some((p) => p.id === patientId)) {
    throw Object.assign(new Error('利用者が見つかりません'), { status: 400 });
  }
  const media = Array.isArray(body.media) ? body.media : [];
  const cleanMedia = media
    .map((m) => ({ file: path.basename(str(m && m.file, 100)), type: m && m.type === 'video' ? 'video' : 'image' }))
    .filter((m) => m.file && fs.existsSync(path.join(UPLOAD_DIR, m.file)));
  const text = str(body.text, 20000);
  if (!text && cleanMedia.length === 0) throw Object.assign(new Error('内容か写真・動画を入れてください'), { status: 400 });
  return {
    date,
    time: /^\d{2}:\d{2}$/.test(time) ? time : '',
    patientId,
    category: str(body.category, 20) || 'その他',
    important: Boolean(body.important),
    author: str(body.author, 30),
    text,
    media: cleanMedia,
  };
}

function sortNotes(notes) {
  // 新しい日付・時刻が上（降順）
  return notes.sort((a, b) =>
    (b.date + (b.time || '99:99') + b.createdAt).localeCompare(a.date + (a.time || '99:99') + a.createdAt)
  );
}

// ---------- API ----------

async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', 'notes', id?]
  const resource = parts[1];
  const id = parts[2];
  const method = req.method;

  if (resource === 'info' && method === 'GET') {
    return sendJson(res, 200, { addresses: lanAddresses(), port: PORT, version: db.version || 0 });
  }

  if (resource === 'version' && method === 'GET') {
    return sendJson(res, 200, { version: db.version || 0 });
  }

  if (resource === 'patients') {
    if (method === 'GET' && !id) {
      const list = [...db.patients].sort((a, b) => (a.kana || a.name).localeCompare(b.kana || b.name, 'ja'));
      return sendJson(res, 200, list);
    }
    if (method === 'POST' && !id) {
      if (db.patients.length >= MAX_PATIENTS) return sendJson(res, 400, { error: '利用者が多すぎます' });
      const p = { id: newId(), ...cleanPatient(await readJson(req)), createdAt: new Date().toISOString() };
      db.patients.push(p);
      commit();
      return sendJson(res, 201, p);
    }
    const p = db.patients.find((x) => x.id === id);
    if (!p) return sendJson(res, 404, { error: '利用者が見つかりません' });
    if (method === 'PUT') {
      Object.assign(p, cleanPatient(await readJson(req)), { updatedAt: new Date().toISOString() });
      commit();
      return sendJson(res, 200, p);
    }
    if (method === 'DELETE') {
      const count = db.notes.filter((n) => n.patientId === id).length;
      if (count > 0) return sendJson(res, 400, { error: `この利用者の記録が ${count} 件あるため削除できません` });
      db.patients = db.patients.filter((x) => x.id !== id);
      commit();
      return sendJson(res, 200, { ok: true });
    }
  }

  if (resource === 'notes') {
    if (method === 'GET' && !id) {
      const q = url.searchParams;
      const patientId = q.get('patientId');
      const from = q.get('from');
      const to = q.get('to');
      const category = q.get('category');
      const keyword = (q.get('q') || '').trim().toLowerCase();
      const importantOnly = q.get('important') === '1';
      let list = db.notes.filter((n) => {
        if (patientId === 'none' ? n.patientId : patientId && n.patientId !== patientId) return false;
        if (from && n.date < from) return false;
        if (to && n.date > to) return false;
        if (category && n.category !== category) return false;
        if (importantOnly && !n.important) return false;
        if (keyword && !`${n.text} ${n.author}`.toLowerCase().includes(keyword)) return false;
        return true;
      });
      return sendJson(res, 200, sortNotes(list));
    }
    if (method === 'POST' && !id) {
      const now = new Date().toISOString();
      const n = { id: newId(), ...cleanNote(await readJson(req)), createdAt: now, updatedAt: now };
      db.notes.push(n);
      commit();
      return sendJson(res, 201, n);
    }
    const n = db.notes.find((x) => x.id === id);
    if (!n) return sendJson(res, 404, { error: '記録が見つかりません' });
    if (method === 'GET') return sendJson(res, 200, n);
    if (method === 'PUT') {
      const before = n.media.map((m) => m.file);
      Object.assign(n, cleanNote(await readJson(req)), { updatedAt: new Date().toISOString() });
      removeUnusedMedia(before);
      commit();
      return sendJson(res, 200, n);
    }
    if (method === 'DELETE') {
      db.notes = db.notes.filter((x) => x.id !== id);
      removeUnusedMedia(n.media.map((m) => m.file));
      commit();
      return sendJson(res, 200, { ok: true });
    }
  }

  // 写真・動画のアップロード（本文はファイルそのもの）
  if (resource === 'upload' && method === 'POST') {
    const original = decodeURIComponent(String(req.headers['x-filename'] || 'file'));
    let ext = path.extname(original).toLowerCase();
    if (!UPLOAD_EXT.has(ext)) return sendJson(res, 400, { error: 'この種類のファイルは使えません（写真か動画を選んでください）' });
    if (ext === '.jpeg') ext = '.jpg';
    const length = Number(req.headers['content-length'] || 0);
    if (length > MAX_UPLOAD_BYTES) return sendJson(res, 413, { error: 'ファイルが大きすぎます（500MBまで）' });
    const file = `${Date.now()}-${newId()}${ext}`;
    const target = path.join(UPLOAD_DIR, file);
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
        sendJson(res, 413, { error: 'ファイルが大きすぎます（500MBまで）' });
      }
    });
    req.pipe(out);
    out.on('finish', () => {
      if (failed) return;
      const type = ['.mp4', '.mov', '.webm', '.m4v', '.3gp'].includes(ext) ? 'video' : 'image';
      sendJson(res, 201, { file, type });
    });
    out.on('error', () => {
      if (!failed) sendJson(res, 500, { error: '保存に失敗しました' });
    });
    return;
  }

  return sendJson(res, 404, { error: '見つかりません' });
}

function commit() {
  db.version = (db.version || 0) + 1;
  saveDb();
  dailyBackup();
}

function removeUnusedMedia(files) {
  const used = new Set(db.notes.flatMap((n) => n.media.map((m) => m.file)));
  for (const f of files) {
    if (!used.has(f)) fs.unlink(path.join(UPLOAD_DIR, path.basename(f)), () => {});
  }
}

// ---------- サーバー ----------

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);

    if (url.pathname.startsWith('/uploads/')) {
      const file = path.basename(decodeURIComponent(url.pathname.slice('/uploads/'.length)));
      return serveFile(req, res, path.join(UPLOAD_DIR, file), { 'Cache-Control': 'max-age=31536000, immutable' });
    }

    let rel = decodeURIComponent(url.pathname);
    if (rel === '/') rel = '/index.html';
    const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
    if (!filePath.startsWith(PUBLIC_DIR + path.sep)) return sendJson(res, 403, { error: '禁止されています' });
    return serveFile(req, res, filePath, { 'Cache-Control': 'no-cache' });
  } catch (err) {
    if (!res.headersSent) sendJson(res, err.status || 500, { error: err.status ? err.message : 'サーバーでエラーが起きました' });
    if (!err.status) console.error(err);
  }
});

function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
}

dailyBackup();
server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('  介護日記 サーバーが起動しました');
  console.log('  ───────────────────────────────');
  console.log(`  このパソコン:   http://localhost:${PORT}`);
  for (const ip of lanAddresses()) console.log(`  ほかの端末から: http://${ip}:${PORT}`);
  console.log(`  データの保存先: ${DATA_DIR}`);
  console.log('  終了するときは このウィンドウを閉じてください');
  console.log('');
});
