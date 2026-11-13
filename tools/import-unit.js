// 前の版（ユニットごとに別サーバー）のデータを、この版のユニットに取りこむ
//   node tools/import-unit.js <前の data フォルダ> <ユニットID> [--force]
// 例）node tools/import-unit.js D:\kaigo-old\data ume
// ・前の data フォルダの中の db.json と uploads を、data/units/<ユニットID>/ にコピーします（元のフォルダは変えません）
// ・そのユニットにすでに記録があるときは、まちがい防止のため止まります（--force で上書き）
// ・サーバーを止めてから実行してください
const fs = require('fs');
const path = require('path');

const [src, id, flag] = process.argv.slice(2);
const root = path.join(__dirname, '..');
const dataDir = process.env.DATA_DIR || path.join(root, 'data');
const units = JSON.parse(fs.readFileSync(process.env.UNITS_FILE || path.join(root, 'units.json'), 'utf8'));

if (!src || !id) {
  console.log('使い方: node tools/import-unit.js <前の data フォルダ> <ユニットID> [--force]');
  console.log('ユニットID: ' + units.map((u) => `${u.id}（${u.name}）`).join('、'));
  process.exit(1);
}
if (!units.some((u) => u.id === id)) {
  console.log(`✗ ユニットID「${id}」は units.json にありません。使えるID: ${units.map((u) => u.id).join(', ')}`);
  process.exit(1);
}
const srcDb = path.join(src, 'db.json');
if (!fs.existsSync(srcDb)) {
  console.log(`✗ ${srcDb} が見つかりません。前の版の data フォルダを指定してください。`);
  process.exit(1);
}
try {
  JSON.parse(fs.readFileSync(srcDb, 'utf8'));
} catch {
  console.log('✗ db.json が壊れています。backups フォルダの db-日付.json を db.json にコピーしてから、もう一度やってください。');
  process.exit(1);
}

const dest = path.join(dataDir, 'units', id);
const destDb = path.join(dest, 'db.json');
if (fs.existsSync(destDb) && flag !== '--force') {
  const cur = JSON.parse(fs.readFileSync(destDb, 'utf8'));
  if ((cur.notes || []).length || (cur.patients || []).length) {
    console.log(`✗ ユニット「${id}」には、もう記録があります（記録 ${(cur.notes || []).length} 件）。上書きするときは最後に --force をつけてください。`);
    process.exit(1);
  }
}
fs.mkdirSync(path.join(dest, 'uploads'), { recursive: true });
if (fs.existsSync(destDb)) fs.copyFileSync(destDb, path.join(dest, `db.before-import-${Date.now()}.json`));
fs.copyFileSync(srcDb, destDb);
let files = 0;
const srcUploads = path.join(src, 'uploads');
if (fs.existsSync(srcUploads)) {
  for (const f of fs.readdirSync(srcUploads)) {
    fs.copyFileSync(path.join(srcUploads, f), path.join(dest, 'uploads', f));
    files++;
  }
}
const db = JSON.parse(fs.readFileSync(destDb, 'utf8'));
console.log(`✓ 取りこみました → ${dest}`);
console.log(`  利用者 ${(db.patients || []).length} 人 / 記録 ${(db.notes || []).length} 件 / 予定 ${(db.events || []).length} 件 / 写真・動画 ${files} 個`);
console.log('  サーバーを起動すると、このユニットで見られます。');
