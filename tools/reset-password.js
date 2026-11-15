// パスワードを忘れたとき（とくにケアマネジャー）に、サーバーのパソコンで直す
//   node tools/reset-password.js            … アカウントの一覧を出す
//   node tools/reset-password.js care       … care のパスワードを、はじめの状態（ID と同じ「care」）に戻す
//   node tools/reset-password.js care abcd  … care のパスワードを「abcd」にする
// サーバーは動かしたままで大丈夫です（次のログインから新しいパスワードになります）。
const fs = require('fs');
const path = require('path');
const { hashPassword, MIN_PASSWORD } = require('../lib/auth');

const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const file = path.join(dataDir, 'accounts.json');
if (!fs.existsSync(file)) {
  console.log(`✗ ${file} がありません。先にサーバーを1回起動してください。`);
  process.exit(1);
}
const accounts = JSON.parse(fs.readFileSync(file, 'utf8'));
const [id, pw] = process.argv.slice(2);
if (!id) {
  console.log('アカウント（ID：名前）');
  for (const a of accounts) console.log(`  ${a.id.padEnd(8)} ${a.name}${a.mustChange ? '  （はじめのパスワードのまま）' : ''}`);
  console.log('\n使い方: node tools/reset-password.js <ID> [新しいパスワード]');
  process.exit(0);
}
const a = accounts.find((x) => x.id === id);
if (!a) {
  console.log(`✗ ID「${id}」はありません。使えるID: ${accounts.map((x) => x.id).join(', ')}`);
  process.exit(1);
}
const next = pw || a.id;
if (next.length < MIN_PASSWORD) {
  console.log(`✗ パスワードは ${MIN_PASSWORD} 文字以上にしてください。`);
  process.exit(1);
}
Object.assign(a, hashPassword(next), { mustChange: true });
fs.writeFileSync(file, JSON.stringify(accounts, null, 1));
// その人のログインを、全部の端末で切る
const sfile = path.join(dataDir, 'sessions.json');
try {
  const s = JSON.parse(fs.readFileSync(sfile, 'utf8'));
  for (const k of Object.keys(s)) if (s[k].id === a.id) delete s[k];
  fs.writeFileSync(sfile, JSON.stringify(s, null, 1));
} catch {}
console.log(`✓ ${a.id}（${a.name}）のパスワードを「${next}」にしました。ログインしたら、自分で変えてください。`);
