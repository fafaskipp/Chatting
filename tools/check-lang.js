// 言語ファイルのチェック：  node tools/check-lang.js
// ・どの言語にも、ja.js と同じ「名前」がそろっているか
// ・{n} や {name} など、プログラムが入れる部分が訳の中で消えていないか
// ・プログラムが使っている名前が、ja.js にちゃんとあるか
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const LANGS = ['ja', 'id', 'si'];
const dict = {};
for (const code of LANGS) {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'public', 'lang', code + '.js'), 'utf8'), sandbox);
  dict[code] = sandbox.window.KAIGO_LANG[code];
}

let problems = 0;
const bad = (msg) => {
  problems++;
  console.log('  ✗ ' + msg);
};

// {m}（数字の月）と {M}（月の名前）は、言語によってどちらを使ってもよい
const placeholders = (v) =>
  Array.isArray(v) ? '' : [...new Set([...String(v).matchAll(/\{(\w+)\}/g)].map((m) => (m[1] === 'M' ? 'm' : m[1])))].sort().join(',');

console.log('1) 言語ごとの名前のそろいかた');
for (const code of LANGS.slice(1)) {
  const miss = Object.keys(dict.ja).filter((k) => !(k in dict[code]));
  const extra = Object.keys(dict[code]).filter((k) => !(k in dict.ja));
  miss.forEach((k) => bad(`${code}: 訳がありません → ${k}`));
  extra.forEach((k) => bad(`${code}: ja.js にない名前です → ${k}`));
  for (const k of Object.keys(dict[code])) {
    if (k in dict.ja && placeholders(dict[code][k]) !== placeholders(dict.ja[k])) {
      bad(`${code}: {…} の部分がちがいます → ${k}  (ja: ${placeholders(dict.ja[k]) || 'なし'} / ${code}: ${placeholders(dict[code][k]) || 'なし'})`);
    }
    if (Array.isArray(dict.ja[k]) && (!Array.isArray(dict[code][k]) || dict[code][k].length !== dict.ja[k].length)) {
      bad(`${code}: 並び（曜日・月）の数がちがいます → ${k}`);
    }
    if (!Array.isArray(dict[code][k]) && String(dict[code][k]).trim() === '') bad(`${code}: 空です → ${k}`);
  }
}

console.log('2) プログラムが使っている名前');
const files = ['public/app.js', 'public/index.html', 'public/i18n.js', 'demo/mock.js', 'demo/build.js'].map((f) => [f, path.join(root, f)]);
const used = new Set();
for (const [name, file] of files) {
  if (!fs.existsSync(file)) continue;
  const text = fs.readFileSync(file, 'utf8');
  for (const m of text.matchAll(/\bth?\(\s*'([\w.]+)'/g)) used.add(m[1]);
  for (const m of text.matchAll(/data-i18n(?:-html|-ph|-title|-aria)?="([\w.]+)"/g)) used.add(m[1]);
  for (const m of text.matchAll(/I18N\.raw\(\s*'([\w.]+)'/g)) used.add(m[1]);
  // 条件で選ぶなど、少し回りくどく使っている名前も「使われている」とみなす
  for (const m of text.matchAll(/['"`]([a-z]\w*(?:\.\w+)+)['"`]/g)) if (m[1] in dict.ja) used.add(m[1]);
}
// 組み立てて使う名前
['today', 'yesterday', 'week', 'month', 'all'].forEach((k) => used.add('title.range.' + k));
['none', 'weekly', 'monthly'].forEach((k) => used.add('repeat.' + k));
for (const k of ['meal', 'water', 'toilet', 'bath', 'med', 'health', 'sleep', 'incident', 'activity', 'family', 'other', 'visit']) used.add('cat.' + k);
const codes = new Set();
for (const f of ['lib/store.js', 'server.js']) {
  const text = fs.readFileSync(path.join(root, f), 'utf8');
  for (const m of text.matchAll(/fail\(\d+,[^;\n]*?,\s*'(\w+)'/g)) codes.add(m[1]);
  for (const m of text.matchAll(/code:\s*'(\w+)'/g)) codes.add(m[1]);
}
codes.forEach((c) => used.add('err.' + c));
['err.network', 'err.upload', 'err.urlInvalid', 'err.readFailed'].forEach((k) => used.add(k));
for (const k of used) if (!k.endsWith('.') && !(k in dict.ja)) bad(`使われているのに ja.js にありません → ${k}`);

const unused = Object.keys(dict.ja).filter((k) => !used.has(k));
if (unused.length) console.log('  （参考）使われていない名前: ' + unused.join(', '));

console.log(problems ? `\n✗ ${problems} 件の問題があります` : `\n✓ 問題なし（${Object.keys(dict.ja).length} 件 × ${LANGS.length} 言語）`);
process.exit(problems ? 1 : 0);
