// データのためしを入れる（動作の確認用）
//   node tools/seed-demo.js [--url http://localhost:3000] [--force] [--passwords kaki=abcd,ume=efgh]
// ・各ユニットのアカウントでログインして入れます（はじめのパスワード＝ID。変えたユニットは --passwords で指定）
// ・サーバーを起動したまま、別のターミナルで実行します（サーバーの API を使うので、自動翻訳も動きます）
// ・8ユニットすべてに、利用者・直近7日分の記録・予定・写真を入れます。日付は「今日」から数えます
// ・すでにデータのあるユニットは、まちがい防止のためとばします（--force で追加）
// ・全部消して最初からやり直すときは、サーバーを止めて data フォルダを消してください
'use strict';
const zlib = require('zlib');

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const val = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const BASE = val('--url', 'http://localhost:3000').replace(/\/$/, '');
const FORCE = flag('--force');
const PASSWORDS = Object.fromEntries(val('--passwords', '').split(',').filter(Boolean).map((x) => x.split('=')));
const cookies = {}; // ユニットID → ログインの Cookie

// ---------- 日付 ----------
const z = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
const daysAgo = (n) => ymd(new Date(Date.now() - n * 86400000));

// ---------- 同じ結果になる乱数 ----------
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// ---------- 利用者 ----------
const SUR = [['山田', 'やまだ'], ['鈴木', 'すずき'], ['佐藤', 'さとう'], ['田中', 'たなか'], ['高橋', 'たかはし'], ['伊藤', 'いとう'], ['渡辺', 'わたなべ'], ['中村', 'なかむら'], ['小林', 'こばやし'], ['加藤', 'かとう'], ['吉田', 'よしだ'], ['山口', 'やまぐち'], ['松本', 'まつもと'], ['井上', 'いのうえ'], ['木村', 'きむら'], ['林', 'はやし'], ['清水', 'しみず'], ['森', 'もり'], ['池田', 'いけだ'], ['橋本', 'はしもと']];
const GIV = [['花子', 'はなこ'], ['太郎', 'たろう'], ['和子', 'かずこ'], ['一郎', 'いちろう'], ['幸子', 'さちこ'], ['清', 'きよし'], ['久子', 'ひさこ'], ['茂', 'しげる'], ['節子', 'せつこ'], ['正雄', 'まさお'], ['静子', 'しずこ'], ['登', 'のぼる']];
const MEMOS = ['卵アレルギー', '右半身にまひあり。移乗は2人で介助', '食事はミキサー食・とろみつき', '転倒リスクが高い。夜間はセンサーマットを使用', '糖尿病（食事制限あり）', '難聴。大きな声でゆっくり話す', '', ''];

// ---------- 記録の文章（種類ごと） ----------
const NOTES = {
  '食事': ['朝食は全量食べました。', '昼食は半分ほど残しました。食欲が少し落ちています。', '夕食は全量。むせ込みなく食べられました。', '間食のゼリーを喜んで食べました。', '食事中にむせ込みがあり、誤嚥に注意して見守りました。'],
  '水分': ['水分は午前中に300ml取れました。', 'お茶をすすめましたが、あまり飲みたがりません。1日の水分量は800mlでした。'],
  '排泄': ['排便が2日ぶりにありました。', '夜間に失禁があり、パッドを交換しました。皮膚の発赤はありません。', 'トイレ誘導で、自分で排尿できました。'],
  '入浴': ['入浴しました。気持ちよさそうでした。', '入浴を拒否されたため、清拭を行いました。', '背中に軽い発赤があり、褥瘡予防のため体位変換を増やしました。'],
  '服薬・薬': ['朝の薬を飲めました。', '夕方の薬を飲み忘れていたため、声かけして服薬してもらいました。'],
  '体調': ['体温36.8度、血圧128/76、脈拍72。バイタルは安定しています。', '少し熱があります（37.8度）。看護師に報告しました。', '咳と痰が多く、看護師に報告しました。', '足に浮腫が見られます。'],
  '睡眠': ['夜はよく眠れていました。', '夜間に不穏があり、何度か居室から出てこられました。付き添うと落ち着かれました。'],
  'ヒヤリ・事故': ['午後2時ごろ、居室で転倒しました。ケガはありません。看護師に報告しました。', '廊下でふらつきがあり、転倒しそうになりました（ヒヤリハット）。職員がそばにいて支えました。', '朝の薬を別の方の分と間違えそうになりました。確認して防ぐことができました（ヒヤリハット）。'],
  'レク・活動': ['午後の体操に参加されました。笑顔が見られました。', '折り紙のレクリエーションに参加。集中して作っていました。'],
  '家族連絡': ['娘さんが面会に来られました。', 'ご家族に電話で近況をお伝えしました。', 'ご家族から着替えの差し入れがありました。'],
  '受診': ['内科を受診しました。薬は変更なしです。', '整形外科を受診しました。', '往診がありました。血圧の薬が追加になりました。'],
};
const WEIGHTS = ['食事', '食事', '食事', '水分', '排泄', '排泄', '入浴', '服薬・薬', '体調', '体調', '睡眠', 'レク・活動', '家族連絡', '受診', 'ヒヤリ・事故'];
const SHARED = ['ユニット全体：午後にレクリエーション（体操）を行いました。', '夜勤の申し送り：全員、落ち着いて就寝されました。', 'エアコンの点検がありました。午前10時から30分ほど。', '来週の行事の準備をしました。'];
const AUTHORS = ['田中', '佐藤', '鈴木', '山本', '中島'];
// となりのユニット（夜勤で2ユニットを見る組み合わせ）
const NEIGHBORS = { momo: 'ume', ume: 'momo', kaki: 'biwa', biwa: 'kaki', nashi: 'yuzu', yuzu: 'nashi', mikan: 'ringo', ringo: 'mikan' };

// ---------- 写真（ためし用の小さな画像。外部ライブラリなしで PNG を作る） ----------
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = t[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
})();
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(CRC(td));
  return Buffer.concat([len, td, crc]);
}
function makePng(w, h, [r, g, b]) {
  const rows = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * 3);
    for (let x = 0; x < w; x++) {
      const f = 0.55 + 0.45 * (x / w) * (1 - y / h * 0.4); // やわらかいグラデーション
      row[1 + x * 3] = Math.min(255, r * f);
      row[2 + x * 3] = Math.min(255, g * f);
      row[3 + x * 3] = Math.min(255, b * f);
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- API ----------
// そのユニットのアカウントでログインする（書けるのは、そのユニットのアカウントだけ）
async function login(unit) {
  const res = await fetch(`${BASE}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: unit, password: PASSWORDS[unit] || unit }) });
  if (!res.ok) throw new Error(`ログインできません（パスワードを変えた場合は --passwords ${unit}=パスワード をつけてください）`);
  cookies[unit] = (res.headers.get('set-cookie') || '').split(';')[0];
}

async function call(unit, method, path, body) {
  const res = await fetch(`${BASE}/u/${unit}/api/${path}`, {
    method,
    headers: { Cookie: cookies[unit], ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path}: ${data.error || res.status}`);
  return data;
}
async function upload(unit, buf, name) {
  const res = await fetch(`${BASE}/u/${unit}/api/upload`, { method: 'POST', headers: { 'x-filename': name, Cookie: cookies[unit] }, body: buf });
  const data = await res.json();
  if (!res.ok) throw new Error('upload: ' + (data.error || res.status));
  return { file: data.file, type: data.type };
}

async function seedUnit(u, idx) {
  const rand = rng(1000 + idx * 77);
  const pick = (a) => a[Math.floor(rand() * a.length)];
  await login(u.id);
  const existing = await call(u.id, 'GET', 'patients');
  const notes = await call(u.id, 'GET', 'notes');
  if ((existing.length || notes.length) && !FORCE) return { skipped: true };

  // 利用者（5人）
  const people = [];
  for (let j = 0; j < 5; j++) {
    const s = SUR[(idx * 5 + j) % SUR.length];
    const g = GIV[(idx * 3 + j * 7) % GIV.length];
    const p = await call(u.id, 'POST', 'patients', {
      name: `${s[0]} ${g[0]}`,
      kana: `${s[1]} ${g[1]}`,
      room: String(101 + idx * 5 + j),
      memo: MEMOS[(idx + j * 3) % MEMOS.length],
    });
    people.push(p);
  }

  // ためし用の写真を3枚
  const colors = [[230, 150, 110], [120, 180, 230], [140, 200, 140]];
  const photos = [];
  for (let k = 0; k < 3; k++) photos.push(await upload(u.id, makePng(240, 160, colors[k]), `demo${k}.png`));

  // 直近7日の記録（1日 5〜8件）
  let count = 0;
  let incidents = 0;
  for (let d = 6; d >= 0; d--) {
    const n = 5 + Math.floor(rand() * 4);
    for (let i = 0; i < n; i++) {
      const cat = pick(WEIGHTS);
      const person = pick(people);
      const text = pick(NOTES[cat]);
      const isInc = cat === 'ヒヤリ・事故';
      if (isInc) incidents++;
      const media = i === 0 && d % 3 === 0 ? [photos[(d / 3) % 3]] : [];
      await call(u.id, 'POST', 'notes', {
        date: daysAgo(d),
        time: `${z(7 + Math.floor(rand() * 13))}:${pick(['00', '15', '30', '45'])}`,
        patientId: person.id,
        category: cat,
        important: isInc || text.includes('熱') || rand() < 0.08,
        author: pick(AUTHORS),
        text,
        media,
      });
      count++;
    }
    // ユニット全体の記録（利用者なし）
    if (d % 2 === 0) {
      await call(u.id, 'POST', 'notes', { date: daysAgo(d), time: '16:30', category: 'その他', author: pick(AUTHORS), text: pick(SHARED), important: false });
      count++;
    }
  }
  // 今日の記録は、ひとつは重要（夜勤の申し送り用）
  await call(u.id, 'POST', 'notes', { date: daysAgo(0), time: '17:00', category: 'その他', important: true, author: '田中', text: `申し送り：${people[0].name.split(' ')[0]}様は夜間の見守りを強めてください。`, patientId: people[0].id });
  count++;

  // 予定
  const ev = [
    { date: daysAgo(0), time: '14:00', title: '内科受診', patientId: people[0].id, memo: '保険証を持っていく' },
    { date: daysAgo(-1), time: '10:00', title: '家族の面会', patientId: people[1].id, memo: '' },
    { date: daysAgo(-2), time: '15:00', title: '往診（整形外科）', patientId: people[2].id, memo: '' },
    { date: daysAgo(0), time: '10:30', title: '体操の時間', patientId: null, repeat: 'weekly', memo: '食堂で行う' },
    { date: daysAgo(-5), time: '14:30', title: '誕生日会', patientId: people[3].id, repeat: 'monthly', memo: 'ケーキを用意する' },
  ];
  for (const e of ev) await call(u.id, 'POST', 'events', e);

  await call(u.id, 'PUT', 'settings', { unitName: u.name, neighborUnit: NEIGHBORS[u.id] || '' });
  return { people: people.length, notes: count, incidents, events: ev.length };
}

(async () => {
  let units;
  try {
    units = (await (await fetch(`${BASE}/api/accounts/public`)).json()).filter((a) => a.role === 'unit').map((a) => ({ id: a.unit, name: a.name }));
  } catch {
    console.log(`✗ サーバーに つながりません（${BASE}）。先に ./start.sh（Windows は start.bat）でサーバーを起動してください。`);
    process.exit(1);
  }
  console.log(`${BASE} に ためしデータを入れます（${units.length} ユニット）\n`);
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    try {
      const r = await seedUnit(u, i);
      console.log(
        r.skipped
          ? `  − ${u.name}: すでにデータがあるので とばしました（追加するときは --force）`
          : `  ✓ ${u.name}: 利用者 ${r.people} 人 / 記録 ${r.notes} 件（ヒヤリ・事故 ${r.incidents}）/ 予定 ${r.events} 件 / 写真 3 枚`
      );
    } catch (err) {
      console.log(`  ✗ ${u.name}: ${err.message}`);
    }
  }
  console.log('\nブラウザで ' + BASE + ' を開いて、ユニットをえらんでください。');
  console.log('自動翻訳を入れている場合、翻訳は裏で順番に進みます（全部終わるまで数分かかります）。');
})();
