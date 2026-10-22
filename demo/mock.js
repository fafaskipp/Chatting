// デモ版：サーバーの代わりにブラウザの中でデータを保存する
(function () {
  'use strict';
  const KEY = 'kaigo-demo-db-v1';
  const SLOT_COUNT = 10;
  const TRASH_DAYS = 30;
  const DEFAULT_CATEGORIES = ['食事', '水分', '排泄', '入浴', '服薬・薬', '体調', '睡眠', '事故・ケガ', 'レク・活動', '家族連絡', 'その他'];
  const memoryMedia = new Map(); // 保存しきれない動画などはメモリだけに置く

  const z = (n) => String(n).padStart(2, '0');
  const localDate = (d = new Date()) => `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
  const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return localDate(d); };
  const newId = () => Math.random().toString(16).slice(2, 10) + Date.now().toString(16).slice(-6);
  const now = () => new Date().toISOString();
  const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const fail = (status, message) => Object.assign(new Error(message), { status });

  let db = load();

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return JSON.parse(raw);
    } catch {}
    return sample();
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(db));
      return true;
    } catch {
      return false;
    }
  }

  function sample() {
    const p = (slot, name, kana, room, memo) => ({ id: 'p' + slot, slot, name, kana, room, memo, createdAt: now() });
    const patients = [
      p(1, '山田 花子', 'やまだ はなこ', '101', 'アレルギー：卵'),
      p(2, '佐藤 一郎', 'さとう いちろう', '102', ''),
      p(3, '鈴木 和子', 'すずき かずこ', '103', '車いす使用'),
      p(5, '田中 正男', 'たなか まさお', '105', ''),
    ];
    const rows = [
      [0, '12:30', 'p1', '食事', '昼食 全量摂取。むせ込みなし。', false, 'グエン'],
      [0, '10:15', 'p3', '事故・ケガ', '居室で転倒。右ひざに軽いすり傷。看護師に報告済み。', true, 'グエン'],
      [0, '09:00', null, '家族連絡', '本日15時に山田様のご家族が面会予定。', true, '佐々木'],
      [0, '08:00', 'p2', '服薬・薬', '朝の薬 服用確認。', false, 'グエン'],
      [1, '14:00', 'p1', '受診', '内科受診。異常なし。次回は来月。', false, '佐々木'],
      [1, '07:30', 'p5', '体調', '37.6度。水分多めにすすめる。', false, 'グエン'],
      [3, '15:00', 'p2', 'レク・活動', '書道レクに参加。笑顔が多かった。', false, '佐々木'],
      [6, '20:00', 'p3', '睡眠', '夜間 2回トイレ。その後よく眠れていた。', false, 'グエン'],
      [12, '11:00', 'p5', '事故・ケガ', '食堂で立ち上がる時にふらつき。転倒なし。', true, '佐々木'],
      [40, '10:00', 'p1', '体調', '食欲低下。昼食 半量。', true, 'グエン'],
    ];
    const notes = rows.map(([ago, time, patientId, category, text, important, author], i) => ({
      id: 'n' + i, date: daysAgo(ago), time, patientId, category, text, important, author, media: [],
      createdAt: now(), updatedAt: now(),
    }));
    return { patients, notes, media: {}, version: 1 };
  }

  function commit() {
    db.version = (db.version || 0) + 1;
    if (!save()) {
      window.dispatchEvent(new CustomEvent('demo-storage-full'));
    }
  }

  // ---- サーバーと同じ処理 ----

  function firstFreeSlot() {
    const used = new Set(db.patients.filter((p) => !p.deletedAt).map((p) => p.slot));
    for (let i = 1; i <= SLOT_COUNT; i++) if (!used.has(i)) return i;
    return null;
  }
  const slotOwner = (slot) => db.patients.find((p) => !p.deletedAt && p.slot === slot);

  function cleanPatient(b) {
    const name = str(b.name, 50);
    if (!name) throw fail(400, '名前を入力してください');
    return { name, kana: str(b.kana, 50), room: str(b.room, 20), memo: str(b.memo, 1000) };
  }

  function cleanNote(b) {
    const date = str(b.date, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw fail(400, '日付が正しくありません');
    const time = str(b.time, 5);
    const patientId = str(b.patientId, 32) || null;
    if (patientId && !db.patients.some((p) => p.id === patientId && !p.deletedAt)) throw fail(400, '利用者が見つかりません');
    const media = (Array.isArray(b.media) ? b.media : [])
      .map((m) => ({ file: str(m && m.file, 100), type: m && m.type === 'video' ? 'video' : 'image' }))
      .filter((m) => m.file && (db.media[m.file] || memoryMedia.has(m.file)));
    const text = str(b.text, 20000);
    if (!text && !media.length) throw fail(400, '内容か写真・動画を入れてください');
    return {
      date, time: /^\d{2}:\d{2}$/.test(time) ? time : '', patientId,
      category: str(b.category, 30) || 'その他', important: Boolean(b.important), author: str(b.author, 30), text, media,
    };
  }

  const sortNotes = (notes) =>
    notes.sort((a, b) => (b.date + (b.time || '99:99') + b.createdAt).localeCompare(a.date + (a.time || '99:99') + a.createdAt));

  function filterNotes(q) {
    const patientId = q.get('patientId');
    const from = q.get('from');
    const to = q.get('to');
    const category = q.get('category');
    const keyword = (q.get('q') || '').trim().toLowerCase();
    const importantOnly = q.get('important') === '1';
    const inTrash = q.get('trash') === '1';
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

  const expiry = (d) => new Date(new Date(d).getTime() + TRASH_DAYS * 86400000).toISOString();

  function trashList() {
    return {
      patients: db.patients
        .filter((p) => p.deletedAt)
        .map((p) => ({ ...p, noteCount: db.notes.filter((n) => n.deletedWithPatient === p.id).length, expiresAt: expiry(p.deletedAt) }))
        .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt)),
      notes: db.notes
        .filter((n) => n.deletedAt && !n.deletedWithPatient)
        .map((n) => ({ ...n, expiresAt: expiry(n.deletedAt) }))
        .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt)),
    };
  }

  function removeUnusedMedia(files) {
    const used = new Set(db.notes.flatMap((n) => n.media.map((m) => m.file)));
    for (const f of files) if (!used.has(f)) { delete db.media[f]; memoryMedia.delete(f); }
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
  function purgeExpiredTrash() {
    const limit = new Date(Date.now() - TRASH_DAYS * 86400000).toISOString();
    const t = trashList();
    const ps = t.patients.filter((p) => p.deletedAt < limit);
    const ns = t.notes.filter((n) => n.deletedAt < limit);
    if (!ps.length && !ns.length) return;
    ps.forEach(purgePatient);
    purgeNotes(ns);
    commit();
  }

  function yearSummary(q) {
    const live = db.notes.filter((n) => !n.deletedAt);
    const years = [...new Set(live.map((n) => n.date.slice(0, 4)))].sort().reverse();
    const year = /^\d{4}$/.test(q.get('year') || '') ? q.get('year') : String(new Date().getFullYear());
    const patientId = q.get('patientId') || '';
    const notes = live.filter((n) => n.date.startsWith(year) && (!patientId || (patientId === 'none' ? !n.patientId : n.patientId === patientId)));
    const months = Array(12).fill(0);
    const categories = new Map();
    const patients = new Map();
    for (const n of notes) {
      months[Number(n.date.slice(5, 7)) - 1]++;
      categories.set(n.category, (categories.get(n.category) || 0) + 1);
      const k = n.patientId || 'none';
      patients.set(k, (patients.get(k) || 0) + 1);
    }
    const names = new Map(db.patients.map((p) => [p.id, p.name]));
    return {
      year,
      years: years.includes(year) ? years : [year, ...years].sort().reverse(),
      total: notes.length,
      months,
      categories: [...categories].sort((a, b) => b[1] - a[1]),
      patients: [...patients].map(([id, count]) => ({ id, name: id === 'none' ? '全体・共有' : names.get(id) || '', count })).sort((a, b) => b.count - a.count),
      important: sortNotes(notes.filter((n) => n.important)),
    };
  }

  function handle(method, url, body) {
    const parts = url.pathname.split('/').filter(Boolean);
    const [, resource, id, action] = parts;
    const q = url.searchParams;

    if (resource === 'info') return { addresses: [], port: 0, slots: SLOT_COUNT, trashDays: TRASH_DAYS };
    if (resource === 'version') return { version: db.version || 0 };
    if (resource === 'categories') {
      const used = db.notes.filter((n) => !n.deletedAt).map((n) => n.category);
      return [...new Set([...DEFAULT_CATEGORIES, ...used])].filter(Boolean);
    }
    if (resource === 'summary') return yearSummary(q);
    if (resource === 'trash' && method === 'GET') return trashList();

    if (resource === 'patients') {
      if (method === 'GET' && !id) return db.patients.filter((p) => !p.deletedAt).sort((a, b) => a.slot - b.slot);
      if (method === 'POST' && !id) {
        const slot = Number(body.slot) || firstFreeSlot();
        if (!slot || slot < 1 || slot > SLOT_COUNT) throw fail(400, '空いている枠がありません。先にだれかを削除してください');
        if (slotOwner(slot)) throw fail(400, `No.${slot} の枠はもう使われています`);
        const p = { id: newId(), slot, ...cleanPatient(body), createdAt: now() };
        db.patients.push(p);
        commit();
        return p;
      }
      const p = db.patients.find((x) => x.id === id);
      if (!p) throw fail(404, '利用者が見つかりません');
      if (method === 'PUT' && !action && !p.deletedAt) {
        Object.assign(p, cleanPatient(body), { updatedAt: now() });
        commit();
        return p;
      }
      if (method === 'DELETE' && !action && !p.deletedAt) {
        p.deletedAt = now();
        p.formerSlot = p.slot;
        p.slot = null;
        for (const n of db.notes) if (n.patientId === p.id && !n.deletedAt) { n.deletedAt = p.deletedAt; n.deletedWithPatient = p.id; }
        commit();
        return { ok: true };
      }
      if (method === 'POST' && action === 'restore' && p.deletedAt) {
        const slot = p.formerSlot && !slotOwner(p.formerSlot) ? p.formerSlot : firstFreeSlot();
        if (!slot) throw fail(400, '空いている枠がないため戻せません。先にだれかを削除してください');
        p.slot = slot;
        delete p.deletedAt;
        delete p.formerSlot;
        for (const n of db.notes) if (n.deletedWithPatient === p.id) { delete n.deletedAt; delete n.deletedWithPatient; }
        commit();
        return p;
      }
      if (method === 'DELETE' && action === 'purge' && p.deletedAt) {
        purgePatient(p);
        commit();
        return { ok: true };
      }
    }

    if (resource === 'notes') {
      if (method === 'GET' && !id) {
        const all = filterNotes(q);
        const limit = Number(q.get('limit'));
        if (!limit) return all;
        const offset = Number(q.get('offset')) || 0;
        return { notes: all.slice(offset, offset + limit), total: all.length };
      }
      if (method === 'POST' && !id) {
        const n = { id: newId(), ...cleanNote(body), createdAt: now(), updatedAt: now() };
        db.notes.push(n);
        commit();
        return n;
      }
      const n = db.notes.find((x) => x.id === id);
      if (!n) throw fail(404, '記録が見つかりません');
      if (method === 'GET' && !action) return n;
      if (method === 'PUT' && !action && !n.deletedAt) {
        const before = n.media.map((m) => m.file);
        Object.assign(n, cleanNote(body), { updatedAt: now() });
        removeUnusedMedia(before);
        commit();
        return n;
      }
      if (method === 'DELETE' && !action && !n.deletedAt) {
        n.deletedAt = now();
        commit();
        return { ok: true };
      }
      if (method === 'POST' && action === 'restore' && n.deletedAt && !n.deletedWithPatient) {
        const owner = n.patientId && db.patients.find((x) => x.id === n.patientId);
        if (owner && owner.deletedAt) throw fail(400, `先に ${owner.name} 様をゴミ箱から戻してください`);
        if (n.patientId && !owner) throw fail(400, 'この記録の利用者はもういません');
        delete n.deletedAt;
        commit();
        return n;
      }
      if (method === 'DELETE' && action === 'purge' && n.deletedAt && !n.deletedWithPatient) {
        purgeNotes([n]);
        commit();
        return { ok: true };
      }
    }
    throw fail(404, '見つかりません');
  }

  // ---- fetch を横取りして、上の処理に回す ----
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, opts = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (!url.pathname.startsWith('/api/')) return realFetch(input, opts);
    const method = (opts.method || 'GET').toUpperCase();
    let status = 200;
    let data;
    try {
      data = handle(method, url, opts.body ? JSON.parse(opts.body) : {});
    } catch (e) {
      status = e.status || 500;
      data = { error: e.status ? e.message : 'エラーが起きました' };
    }
    return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  };

  // 写真はブラウザの中に保存（動画は大きいので、このページを開いている間だけ）
  window.demoUpload = (file) =>
    new Promise((resolve, reject) => {
      const isVideo = file.type.startsWith('video/');
      const file_id = `${Date.now()}-${newId()}`;
      if (isVideo) {
        memoryMedia.set(file_id, URL.createObjectURL(file));
        return resolve({ file: file_id, type: 'video' });
      }
      if (!file.type.startsWith('image/')) return reject(new Error('この種類のファイルは使えません（写真を選んでください）'));
      const r = new FileReader();
      r.onload = () => {
        db.media[file_id] = r.result;
        resolve({ file: file_id, type: 'image' });
      };
      r.onerror = () => reject(new Error('読み込みに失敗しました'));
      r.readAsDataURL(file);
    });

  window.demoMedia = (file) => db.media[file] || memoryMedia.get(file) || '';

  window.demoReset = () => {
    db = sample();
    save();
  };

  purgeExpiredTrash();
})();
