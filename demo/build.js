// public/ の本物のファイルから、iPad などで試せるデモ用の1ファイル HTML を作る
// 使い方: node demo/build.js  → demo/kaigo-demo.html
const fs = require('fs');
const path = require('path');
const repo = path.join(__dirname, "..");
const out = process.argv[2] || path.join(__dirname, "kaigo-demo.html");
const read = (f) => fs.readFileSync(path.join(repo, 'public', f), 'utf8');
const html = read('index.html');
const css = read('style.css');
let app = read('app.js');
const mock = fs.readFileSync(path.join(repo, 'lib', 'store.js'), 'utf8') + '\n' + fs.readFileSync(path.join(__dirname, 'mock.js'), 'utf8');

const swap = (from, to) => {
  if (!app.includes(from)) throw new Error('not found: ' + from);
  app = app.split(from).join(to);
};
swap('/uploads/${esc(m.file)}', '${esc(demoMedia(m.file))}');
swap('function uploadFile(file) {', 'function uploadFile(file) {\n  return demoUpload(file);\n}\nfunction uploadFileServer(file) {');

let body = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>')).replace(/<script src="app.js"><\/script>/, '');
body = body.replace('<main>', `<main>
    <div class="demo-banner">
      <div>🧪 <b>デモ版</b>（試すための版です）　データはこの端末のブラウザの中だけに保存されます。<br>印刷・ほかの端末との共有は、パソコンで動かす本番版で使えます。</div>
      <button type="button" class="btn btn-gray" id="demo-reset">↺ サンプルに戻す</button>
    </div>`);

const demoCss = `
.topbar { top: env(safe-area-inset-top, 0px); padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
body::before { content: ""; position: fixed; inset: 0 0 auto; height: env(safe-area-inset-top, 0px); z-index: 10; background: var(--blue); }
main { padding-left: max(16px, env(safe-area-inset-left, 0px)) !important; padding-right: max(16px, env(safe-area-inset-right, 0px)) !important; }
[data-print] { display: none !important; }
.demo-banner { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; justify-content: space-between; background: #ede7f6; border-left: 8px solid #6a1b9a; border-radius: 6px; padding: 10px 14px; margin-bottom: 14px; }
.demo-banner > div { flex: 1 1 260px; min-width: 0; }
.demo-banner .btn { min-height: 44px; font-size: 1rem; }
`;

const demoJs = `
document.getElementById('demo-reset').addEventListener('click', async () => {
  if (await askConfirm('入力したデータを消して、最初のサンプルに戻しますか？')) { demoReset(); location.reload(); }
});
window.addEventListener('demo-storage-full', () => toast('保存できる容量がいっぱいです。写真を減らしてください'));
setTimeout(() => {
  const info = document.getElementById('server-info');
  if (info) info.textContent = '💻 本番版では、ここにほかのパソコン・タブレットから開くアドレスが表示されます。';
}, 300);
`;

const page = `<title>介護日記 デモ</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>
${css}
${demoCss}
</style>
${body}
<script>
${mock}
</script>
<script>
${app}
${demoJs}
</script>
`;
fs.writeFileSync(out, page);
console.log('wrote', out, page.length, 'bytes');
