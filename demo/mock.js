// デモ版：サーバーの代わりにブラウザの中でデータを保存する
// データの処理は本番と同じ lib/store.js（KaigoStore）を使う。
(function () {
  'use strict';
  const KEY = 'kaigo-demo-db-v1';
  const memoryMedia = new Map(); // 保存しきれない動画は、このページを開いている間だけ置く
  const z = (n) => String(n).padStart(2, '0');
  const localDate = (d = new Date()) => `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
  const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return localDate(d); };
  const monthAgo = (n) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - n); return localDate(d).slice(0, 7); };
  const now = () => new Date().toISOString();

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
      [0, '10:15', 'p3', 'ヒヤリ・事故', '居室で転倒。右ひざに軽いすり傷。看護師に報告済み。', true, 'グエン'],
      [0, '09:00', null, '家族連絡', '本日15時に山田様のご家族が面会予定。', true, '佐々木'],
      [0, '08:00', 'p2', '服薬・薬', '朝の薬 服用確認。', false, 'グエン'],
      [1, '14:00', 'p1', '受診', '内科受診。異常なし。次回は来月。', false, '佐々木'],
      [1, '07:30', 'p5', '体調', '37.6度。水分多めにすすめる。', false, 'グエン'],
      [3, '15:00', 'p2', 'レク・活動', '書道レクに参加。笑顔が多かった。', false, '佐々木'],
      [6, '20:00', 'p3', '睡眠', '夜間 2回トイレ。その後よく眠れていた。', false, 'グエン'],
      [12, '11:00', 'p5', 'ヒヤリ・事故', '食堂で立ち上がる時にふらつき。転倒なし。', true, '佐々木'],
      [40, '10:00', 'p1', '体調', '食欲低下。昼食 半量。', true, 'グエン'],
      [45, '02:10', 'p3', 'ヒヤリ・事故', '夜間 ベッドから立ち上がろうとしてふらつき。職員が支えて転倒なし。', true, 'グエン'],
    ];
    const notes = rows.map(([ago, time, patientId, category, text, important, author], i) => ({
      id: 'n' + i, date: daysAgo(ago), time, patientId, category, text, important, author, media: [],
      createdAt: now(), updatedAt: now(),
    }));
    const item = (trend, text = '') => ({ trend, text });
    const reports = [
      {
        id: 'r1', month: monthAgo(1), patientId: 'p1',
        items: {
          health: item('down', '月の前半に食欲低下あり。'), meal: item('down', '半量の日が多かった。'),
          excretion: item('same'), sleep: item('same'), adl: item('same', '歩行は見守りで安定。'), mood: item('same', '表情はおだやか。'),
        },
        incidentReview: '', incidentPlan: '', summary: '食事量の低下に注意。来月は好きなおかずを増やして様子を見る。',
        author: '佐々木', createdAt: now(), updatedAt: now(),
      },
      {
        id: 'r2', month: monthAgo(1), patientId: 'p3',
        items: {
          health: item('same'), meal: item('same'), excretion: item('same', '夜間トイレ 2〜3回。'),
          sleep: item('down', '夜中に目が覚めることが増えた。'), adl: item('down', '立ち上がりでふらつきあり。'), mood: item('same'),
        },
        incidentReview: '夜間トイレに行こうとして、暗い中で一人で立ち上がった。',
        incidentPlan: '足元灯をつける。夜間の見回りを 2時・4時 に増やす。',
        summary: '夜間の転倒に注意。来月は夜の様子を重点的に見る。',
        author: 'グエン', createdAt: now(), updatedAt: now(),
      },
    ];
    return { patients, notes, reports, media: {}, version: 1 };
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return JSON.parse(raw);
    } catch {}
    return sample();
  }

  function save(db) {
    try {
      localStorage.setItem(KEY, JSON.stringify(db));
    } catch {
      window.dispatchEvent(new CustomEvent('demo-storage-full'));
    }
  }

  let store;
  function start(db) {
    db.media = db.media || {};
    store = KaigoStore.createStore({
      db,
      mediaExists: (f) => Boolean(db.media[f] || memoryMedia.has(f)),
      removeMedia: (f) => { delete db.media[f]; memoryMedia.delete(f); },
      onChange: save,
    });
    store.purgeExpiredTrash();
  }
  start(load());

  // fetch を横取りして、ブラウザの中の store に回す
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, opts = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (!url.pathname.startsWith('/api/')) return realFetch(input, opts);
    const method = (opts.method || 'GET').toUpperCase();
    let status = 200;
    let data;
    try {
      if (url.pathname === '/api/info') data = { addresses: [], port: 0, slots: 10, trashDays: 30 };
      else data = store.handle(method, url.pathname, url.searchParams, opts.body ? JSON.parse(opts.body) : {});
    } catch (e) {
      status = e.status || 500;
      data = { error: e.status ? e.message : 'エラーが起きました' };
      if (!e.status) console.error(e);
    }
    return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  };

  window.demoUpload = (file) =>
    new Promise((resolve, reject) => {
      const id = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
      if (file.type.startsWith('video/')) {
        memoryMedia.set(id, URL.createObjectURL(file));
        return resolve({ file: id, type: 'video' });
      }
      if (!file.type.startsWith('image/')) return reject(new Error('この種類のファイルは使えません（写真を選んでください）'));
      const r = new FileReader();
      r.onload = () => {
        store.db.media[id] = r.result;
        resolve({ file: id, type: 'image' });
      };
      r.onerror = () => reject(new Error('読み込みに失敗しました'));
      r.readAsDataURL(file);
    });

  window.demoMedia = (file) => store.db.media[file] || memoryMedia.get(file) || '';

  window.demoReset = () => {
    const db = sample();
    save(db);
    start(db);
  };
})();
