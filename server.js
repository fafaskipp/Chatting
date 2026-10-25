// 介護日記 — オフラインで動く LAN 共有サーバー（外部ライブラリ不要）
// 使い方: node server.js  → 表示される http://<IP>:3000 を他のパソコン/スマホのブラウザで開く

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { createStore, localDate } = require('./lib/store');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
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

// ---------- データベース（JSON ファイル） ----------

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(BACKUP_DIR, { recursive: true });

// db.json が壊れていたら、いちばん新しいバックアップから読み込む（壊れたファイルは名前を変えて残す）
function loadDb() {
  if (!fs.existsSync(DB_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (err) {
    const broken = `${DB_FILE}.broken-${Date.now()}`;
    fs.renameSync(DB_FILE, broken);
    console.log(`  [!] db.json rusak dan disimpan sebagai ${path.basename(broken)}.`);
    const backups = fs.existsSync(BACKUP_DIR) ? fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith('db-')).sort().reverse() : [];
    for (const f of backups) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, f), 'utf8'));
        console.log(`      Data dipulihkan dari backup ${f}.`);
        fs.copyFileSync(path.join(BACKUP_DIR, f), DB_FILE);
        return data;
      } catch {}
    }
    console.log('      Tidak ada backup yang bisa dipakai. Mulai dengan data kosong.');
    return {};
  }
}

const store = createStore({
  db: loadDb(),
  slotCount: SLOT_COUNT,
  trashDays: TRASH_DAYS,
  newId,
  mediaExists: (file) => fs.existsSync(path.join(UPLOAD_DIR, path.basename(file))),
  removeMedia: (file) => fs.unlink(path.join(UPLOAD_DIR, path.basename(file)), () => {}),
  onChange: () => {
    saveDb();
    dailyBackup();
  },
});

// 書き込みは一時ファイル→リネームで、途中で電源が切れても壊れにくくする
// 同時に何人が保存しても、Node は1件ずつ順番に処理するので記録は失われない
function saveDb() {
  const tmp = DB_FILE + '.tmp';
  const data = JSON.stringify(store.db);
  fs.writeFileSync(tmp, data);
  try {
    fs.renameSync(tmp, DB_FILE);
  } catch {
    // Windows でウイルス対策ソフトがファイルを開いているときなど
    fs.writeFileSync(DB_FILE, data);
    fs.rmSync(tmp, { force: true });
  }
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

// ファイルが途中で消えても、サーバー全体が止まらないようにする
function pipeFile(stream, res) {
  stream.on('error', () => res.destroy());
  stream.pipe(res);
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
      return pipeFile(fs.createReadStream(filePath, { start, end }), res);
    }
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': stat.size, 'Accept-Ranges': 'bytes', ...extraHeaders });
    pipeFile(fs.createReadStream(filePath), res);
  });
}

// ---------- API ----------

async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', 'notes', id?, action?]
  const resource = parts[1];
  const method = req.method;

  if (resource === 'info' && method === 'GET') {
    return sendJson(res, 200, { addresses: lanAddresses(), port: PORT, slots: SLOT_COUNT, trashDays: TRASH_DAYS });
  }

  if (resource === 'export.csv' && method === 'GET') {
    const filename = `介護日記_${localDate()}.csv`;
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="kaigo.csv"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Cache-Control': 'no-store',
    });
    return res.end(store.csv(url.searchParams));
  }

  // 写真・動画のアップロード（本文はファイルそのもの）
  if (resource === 'upload' && method === 'POST') {
    const original = decodeURIComponent(String(req.headers['x-filename'] || 'file'));
    let ext = path.extname(original).toLowerCase();
    if (!UPLOAD_EXT.has(ext)) return sendJson(res, 400, { error: 'この種類のファイルは使えません（写真か動画を選んでください）' });
    if (ext === '.jpeg') ext = '.jpg';
    const length = Number(req.headers['content-length'] || 0);
    if (length > MAX_UPLOAD_BYTES) return sendJson(res, 413, { error: 'ファイルが大きすぎます（100MBまで）' });
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
        sendJson(res, 413, { error: 'ファイルが大きすぎます（100MBまで）' });
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
      if (!failed) sendJson(res, 500, { error: '保存に失敗しました' });
    });
    return;
  }

  const body = method === 'POST' || method === 'PUT' ? await readJson(req) : {};
  return sendJson(res, 200, store.handle(method, url.pathname, url.searchParams, body));
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

// 家や施設の Wi-Fi でよく使うアドレス（192.168.x.x）を先に出す
function lanAddresses() {
  const rank = (ip) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : 2);
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254.'))
    .map((i) => i.address)
    .sort((a, b) => rank(a) - rank(b));
}

// 入力画面で写真を追加して「やめる」と、どの記録にも使われない写真が残るので、1日たったら消す
function removeOrphanUploads() {
  const used = new Set(store.db.notes.flatMap((n) => n.media.map((m) => m.file)));
  const dayAgo = Date.now() - 86400000;
  for (const f of fs.readdirSync(UPLOAD_DIR)) {
    if (used.has(f)) continue;
    const full = path.join(UPLOAD_DIR, f);
    try {
      if (fs.statSync(full).mtimeMs < dayAgo) fs.unlinkSync(full);
    } catch {}
  }
}

function housekeeping() {
  try {
    store.purgeExpiredTrash();
    removeOrphanUploads();
  } catch (err) {
    console.error(err);
  }
}

dailyBackup();
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
  console.log('  介護日記 サーバーが起動しました');
  console.log('  ───────────────────────────────');
  console.log(`  このパソコン:   http://localhost:${PORT}`);
  for (const ip of lanAddresses()) console.log(`  ほかの端末から: http://${ip}:${PORT}`);
  console.log(`  データの保存先: ${DATA_DIR}`);
  console.log('  終了するときは このウィンドウを閉じてください');
  console.log('');
});
