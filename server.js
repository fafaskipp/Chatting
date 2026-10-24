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

function loadDb() {
  if (!fs.existsSync(DB_FILE)) return { patients: [], notes: [] };
  const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  db.patients = db.patients || [];
  db.notes = db.notes || [];
  // 種類の名前を変えたので、以前の記録も新しい名前にそろえる
  for (const n of db.notes) if (n.category === '事故・ケガ') n.category = 'ヒヤリ・事故';
  // 以前の版のデータに枠番号を付ける
  for (const p of db.patients) {
    if (!p.slot && !p.deletedAt) p.slot = firstFreeSlot(db);
  }
  return db;
}

function firstFreeSlot(d = db) {
  const used = new Set(d.patients.filter((p) => !p.deletedAt).map((p) => p.slot));
  for (let i = 1; i <= SLOT_COUNT; i++) if (!used.has(i)) return i;
  return null;
}

function slotOwner(slot) {
  return db.patients.find((p) => !p.deletedAt && p.slot === slot);
}

let db = loadDb();

// 書き込みは一時ファイル→リネームで、途中で電源が切れても壊れにくくする
// 同時に何人が保存しても、Node は1件ずつ順番に処理するので記録は失われない
function saveDb() {
  const tmp = DB_FILE + '.tmp';
  const data = JSON.stringify(db);
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

function fail(status, message) {
  return Object.assign(new Error(message), { status });
}

function cleanPatient(body) {
  const name = str(body.name, 50);
  if (!name) throw fail(400, '名前を入力してください');
  return {
    name,
    kana: str(body.kana, 50),
    room: str(body.room, 20),
    memo: str(body.memo, 1000),
  };
}

function cleanNote(body) {
  const date = str(body.date, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw fail(400, '日付が正しくありません');
  const time = str(body.time, 5);
  const patientId = str(body.patientId, 32) || null;
  if (patientId && !db.patients.some((p) => p.id === patientId && !p.deletedAt)) {
    throw fail(400, '利用者が見つかりません');
  }
  const media = Array.isArray(body.media) ? body.media : [];
  const cleanMedia = media
    .map((m) => ({ file: path.basename(str(m && m.file, 100)), type: m && m.type === 'video' ? 'video' : 'image' }))
    .filter((m) => m.file && fs.existsSync(path.join(UPLOAD_DIR, m.file)));
  const text = str(body.text, 20000);
  if (!text && cleanMedia.length === 0) throw fail(400, '内容か写真・動画を入れてください');
  return {
    date,
    time: /^\d{2}:\d{2}$/.test(time) ? time : '',
    patientId,
    category: str(body.category, 30) || 'その他',
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

const DEFAULT_CATEGORIES = ['食事', '水分', '排泄', '入浴', '服薬・薬', '体調', '睡眠', 'ヒヤリ・事故', 'レク・活動', '家族連絡', 'その他'];

function activePatients() {
  return db.patients.filter((p) => !p.deletedAt);
}

function filterNotes(q) {
  const patientId = q.get('patientId');
  const from = q.get('from');
  const to = q.get('to');
  const category = q.get('category');
  const keyword = (q.get('q') || '').trim().toLowerCase();
  const importantOnly = q.get('important') === '1';
  const inTrash = q.get('trash') === '1'; // ゴミ箱の利用者の記録を見るとき
  return sortNotes(
    db.notes.filter((n) => {
      if (inTrash ? !n.deletedWithPatient : n.deletedAt) return false;
      if (patientId === 'none' ? n.patientId : patientId && n.patientId !== patientId) return false;
      if (from && n.date < from) return false;
      if (to && n.date > to) return false;
      if (category && n.category !== category) return false;
      if (importantOnly && !n.important) return false;
      if (keyword && !`${n.text} ${n.author} ${n.category}`.toLowerCase().includes(keyword)) return false;
      return true;
    })
  );
}

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exportCsv(res, notes) {
  const names = new Map(db.patients.map((p) => [p.id, p.name]));
  const rows = [['日付', '時刻', '利用者', '種類', '重要', '内容', '記入者', '写真・動画']];
  for (const n of notes) {
    rows.push([
      n.date,
      n.time,
      n.patientId ? names.get(n.patientId) || '' : '全体・共有',
      n.category,
      n.important ? '★' : '',
      n.text,
      n.author,
      n.media.length ? `${n.media.length}件` : '',
    ]);
  }
  // Excel で文字化けしないよう BOM 付き UTF-8
  const body = '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  const filename = `介護日記_${localDate()}.csv`;
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="kaigo.csv"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

// 年間まとめ：月ごと・種類ごと・利用者ごとの件数と、重要な記録の一覧
function yearSummary(q) {
  const live = db.notes.filter((n) => !n.deletedAt);
  const years = [...new Set(live.map((n) => n.date.slice(0, 4)))].sort().reverse();
  const year = /^\d{4}$/.test(q.get('year') || '') ? q.get('year') : String(new Date().getFullYear());
  const patientId = q.get('patientId') || '';
  const notes = live.filter(
    (n) => n.date.startsWith(year) && (!patientId || (patientId === 'none' ? !n.patientId : n.patientId === patientId))
  );
  const months = Array(12).fill(0);
  const categories = new Map();
  const patients = new Map();
  for (const n of notes) {
    months[Number(n.date.slice(5, 7)) - 1]++;
    categories.set(n.category, (categories.get(n.category) || 0) + 1);
    const key = n.patientId || 'none';
    patients.set(key, (patients.get(key) || 0) + 1);
  }
  const names = new Map(db.patients.map((p) => [p.id, p.name]));
  return {
    year,
    years: years.includes(year) ? years : [year, ...years].sort().reverse(),
    total: notes.length,
    months,
    categories: [...categories].sort((a, b) => b[1] - a[1]),
    patients: [...patients]
      .map(([id, count]) => ({ id, name: id === 'none' ? '全体・共有' : names.get(id) || '', count }))
      .sort((a, b) => b.count - a.count),
    important: sortNotes(notes.filter((n) => n.important)),
  };
}

function purgeExpiredTrash() {
  const limit = new Date(Date.now() - TRASH_DAYS * 86400000).toISOString();
  const t = trashList();
  const oldPatients = t.patients.filter((p) => p.deletedAt < limit);
  const oldNotes = t.notes.filter((n) => n.deletedAt < limit);
  if (!oldPatients.length && !oldNotes.length) return;
  for (const p of oldPatients) purgePatient(p);
  purgeNotes(oldNotes);
  commit();
}

function trashList() {
  const patients = db.patients
    .filter((p) => p.deletedAt)
    .map((p) => ({ ...p, noteCount: db.notes.filter((n) => n.deletedWithPatient === p.id).length, expiresAt: expiry(p.deletedAt) }))
    .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  const notes = db.notes
    .filter((n) => n.deletedAt && !n.deletedWithPatient)
    .map((n) => ({ ...n, expiresAt: expiry(n.deletedAt) }))
    .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  return { patients, notes };
}

function expiry(deletedAt) {
  return new Date(new Date(deletedAt).getTime() + TRASH_DAYS * 86400000).toISOString();
}

function purgeNotes(notes) {
  const ids = new Set(notes.map((n) => n.id));
  db.notes = db.notes.filter((n) => !ids.has(n.id));
  removeUnusedMedia(notes.flatMap((n) => n.media.map((m) => m.file)));
}

function purgePatient(p) {
  purgeNotes(db.notes.filter((n) => n.deletedWithPatient === p.id));
  db.patients = db.patients.filter((x) => x.id !== p.id);
}

async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', 'notes', id?, action?]
  const resource = parts[1];
  const id = parts[2];
  const action = parts[3];
  const method = req.method;
  const now = () => new Date().toISOString();

  if (resource === 'info' && method === 'GET') {
    return sendJson(res, 200, { addresses: lanAddresses(), port: PORT, slots: SLOT_COUNT, trashDays: TRASH_DAYS });
  }

  if (resource === 'version' && method === 'GET') {
    return sendJson(res, 200, { version: db.version || 0 });
  }

  if (resource === 'categories' && method === 'GET') {
    const used = db.notes.filter((n) => !n.deletedAt).map((n) => n.category);
    return sendJson(res, 200, [...new Set([...DEFAULT_CATEGORIES, ...used])].filter(Boolean));
  }

  if (resource === 'patients') {
    if (method === 'GET' && !id) {
      return sendJson(res, 200, activePatients().sort((a, b) => a.slot - b.slot));
    }
    if (method === 'POST' && !id) {
      const body = await readJson(req);
      const slot = Number(body.slot) || firstFreeSlot();
      if (!slot || slot < 1 || slot > SLOT_COUNT) throw fail(400, '空いている枠がありません。先にだれかを削除してください');
      if (slotOwner(slot)) throw fail(400, `No.${slot} の枠はもう使われています`);
      const p = { id: newId(), slot, ...cleanPatient(body), createdAt: now() };
      db.patients.push(p);
      commit();
      return sendJson(res, 201, p);
    }
    const p = db.patients.find((x) => x.id === id);
    if (!p) return sendJson(res, 404, { error: '利用者が見つかりません' });
    if (method === 'PUT' && !action && !p.deletedAt) {
      Object.assign(p, cleanPatient(await readJson(req)), { updatedAt: now() });
      commit();
      return sendJson(res, 200, p);
    }
    // 削除 → 記録といっしょにゴミ箱へ。枠は空きになる
    if (method === 'DELETE' && !action && !p.deletedAt) {
      p.deletedAt = now();
      p.formerSlot = p.slot;
      p.slot = null;
      for (const n of db.notes) {
        if (n.patientId === p.id && !n.deletedAt) {
          n.deletedAt = p.deletedAt;
          n.deletedWithPatient = p.id;
        }
      }
      commit();
      return sendJson(res, 200, { ok: true });
    }
    if (method === 'POST' && action === 'restore' && p.deletedAt) {
      const slot = p.formerSlot && !slotOwner(p.formerSlot) ? p.formerSlot : firstFreeSlot();
      if (!slot) throw fail(400, '空いている枠がないため戻せません。先にだれかを削除してください');
      p.slot = slot;
      delete p.deletedAt;
      delete p.formerSlot;
      for (const n of db.notes) {
        if (n.deletedWithPatient === p.id) {
          delete n.deletedAt;
          delete n.deletedWithPatient;
        }
      }
      commit();
      return sendJson(res, 200, p);
    }
    if (method === 'DELETE' && action === 'purge' && p.deletedAt) {
      purgePatient(p);
      commit();
      return sendJson(res, 200, { ok: true });
    }
  }

  if (resource === 'summary' && method === 'GET') {
    return sendJson(res, 200, yearSummary(url.searchParams));
  }

  if (resource === 'export.csv' && method === 'GET') {
    return exportCsv(res, filterNotes(url.searchParams));
  }

  if (resource === 'notes') {
    if (method === 'GET' && !id) {
      const all = filterNotes(url.searchParams);
      const limit = Number(url.searchParams.get('limit'));
      if (!limit) return sendJson(res, 200, all);
      const offset = Number(url.searchParams.get('offset')) || 0;
      return sendJson(res, 200, { notes: all.slice(offset, offset + limit), total: all.length });
    }
    if (method === 'POST' && !id) {
      const n = { id: newId(), ...cleanNote(await readJson(req)), createdAt: now(), updatedAt: now() };
      db.notes.push(n);
      commit();
      return sendJson(res, 201, n);
    }
    const n = db.notes.find((x) => x.id === id);
    if (!n) return sendJson(res, 404, { error: '記録が見つかりません' });
    if (method === 'GET' && !action) return sendJson(res, 200, n);
    if (method === 'PUT' && !action && !n.deletedAt) {
      const before = n.media.map((m) => m.file);
      Object.assign(n, cleanNote(await readJson(req)), { updatedAt: now() });
      removeUnusedMedia(before);
      commit();
      return sendJson(res, 200, n);
    }
    if (method === 'DELETE' && !action && !n.deletedAt) {
      n.deletedAt = now();
      commit();
      return sendJson(res, 200, { ok: true });
    }
    if (method === 'POST' && action === 'restore' && n.deletedAt && !n.deletedWithPatient) {
      const owner = n.patientId && db.patients.find((x) => x.id === n.patientId);
      if (owner && owner.deletedAt) throw fail(400, `先に ${owner.name} 様をゴミ箱から戻してください`);
      if (n.patientId && !owner) throw fail(400, 'この記録の利用者はもういません');
      delete n.deletedAt;
      commit();
      return sendJson(res, 200, n);
    }
    if (method === 'DELETE' && action === 'purge' && n.deletedAt && !n.deletedWithPatient) {
      purgeNotes([n]);
      commit();
      return sendJson(res, 200, { ok: true });
    }
  }

  if (resource === 'trash') {
    if (method === 'GET') return sendJson(res, 200, trashList());
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
purgeExpiredTrash();
setInterval(purgeExpiredTrash, 60 * 60 * 1000);
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
