'use strict';
// 📱 QRコード：ほかの端末（スマホ・タブレット）で、介護日記をすぐ開けるようにする。インターネットなしで動く
// ・「📒 介護日記」やユニットの名前を押すと出る（data-qr を付けた要素）
// ・このパソコン（localhost）で開いているときは、ほかの端末から届くアドレス（192.168.x.x など）を使う
(function () {
  const T = (k, p) => (window.I18N ? I18N.t(k, p) : k);
  const E = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const isLocal = (h) => h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]';

  const css = `
  .qr-dialog { border: none; border-radius: 18px; padding: 0; width: min(440px, calc(100vw - 20px)); max-height: calc(100vh - 20px); overflow: auto; box-shadow: 0 10px 40px rgba(0,0,0,.35); color: #1f2328; background: #fff; }
  .qr-dialog::backdrop { background: rgba(0,0,0,.5); }
  .qr-box { padding: 20px 20px 18px; text-align: center; font-size: 1.05rem; line-height: 1.6; }
  .qr-box h2 { margin: 0 0 4px; font-size: 1.35rem; }
  .qr-box p { margin: 0 0 10px; color: #4a5160; }
  .qr-code { display: block; width: min(300px, 72vw); height: auto; margin: 6px auto 10px; background: #fff; border: 1px solid #e0e0e0; border-radius: 10px; image-rendering: pixelated; }
  .qr-url { display: block; font: 700 1.05rem/1.4 ui-monospace, Consolas, monospace; word-break: break-all; padding: 8px 10px; background: #f3f6fb; border-radius: 10px; margin-bottom: 10px; color: #0d3c61; }
  .qr-addrs { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; margin-bottom: 10px; }
  .qr-addrs button { min-height: 40px; padding: 4px 12px; border-radius: 999px; border: 2px solid #1565c0; background: #fff; color: #1565c0; font: inherit; font-weight: 800; cursor: pointer; }
  .qr-addrs button.on { background: #1565c0; color: #fff; }
  .qr-actions { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
  .qr-actions button { min-height: 50px; padding: 8px 20px; border-radius: 14px; border: none; font: inherit; font-weight: 800; cursor: pointer; }
  .qr-copy { background: #e3f2fd; color: #0d3c61; }
  .qr-close { background: #616161; color: #fff; }
  .qr-warn { background: #fff3c4; color: #5a4300; border-radius: 10px; padding: 8px 12px; margin-bottom: 10px; font-weight: 700; }
  [data-qr] { cursor: pointer; }
  @media print { .qr-dialog { display: none !important; } }`;

  let dlg = null;
  let state = { urls: [], i: 0, path: '/' };

  function ensureDialog() {
    if (dlg) return dlg;
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    dlg = document.createElement('dialog');
    dlg.className = 'qr-dialog';
    dlg.setAttribute('data-nofurigana', ''); // URL にふりがなをつけない
    document.body.appendChild(dlg);
    dlg.addEventListener('click', async (e) => {
      if (e.target === dlg || e.target.closest('.qr-close')) return dlg.close();
      const a = e.target.closest('[data-qri]');
      if (a) {
        state.i = Number(a.dataset.qri);
        return render();
      }
      if (e.target.closest('.qr-copy')) {
        const btn = e.target.closest('.qr-copy');
        const done = await copyText(state.urls[state.i]);
        btn.textContent = done ? T('qr.copied') : T('qr.copyManual');
      }
    });
    return dlg;
  }

  // アドレスをコピーする。http://192.168.x.x のように https でないアドレスで開いていると、
  // ブラウザは navigator.clipboard を使わせないので、そのときは昔からある方法（execCommand）でコピーする
  async function copyText(text) {
    if (window.isSecureContext && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {}
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    Object.assign(ta.style, { position: 'fixed', top: '0', left: '0', width: '1px', height: '1px', opacity: '0' });
    dlg.appendChild(ta); // ダイアログの中に置く（外だと、開いているダイアログのせいで選べない）
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length); // iPhone・iPad 用
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {}
    ta.remove();
    if (!ok) {
      // それでもだめなとき：アドレスを選んだ状態にして、自分でコピーしてもらう
      const r = document.createRange();
      r.selectNodeContents(dlg.querySelector('.qr-url'));
      getSelection().removeAllRanges();
      getSelection().addRange(r);
    }
    return ok;
  }

  function svgFor(text) {
    const q = window.qrcode(0, 'M');
    q.addData(text);
    q.make();
    return q.createSvgTag({ cellSize: 8, margin: 4, scalable: true, alt: text, title: text }).replace('<svg ', '<svg class="qr-code" role="img" ');
  }

  function render() {
    const url = state.urls[state.i];
    dlg.innerHTML = `<div class="qr-box">
      <h2>📱 ${E(T('qr.title'))}</h2>
      <p>${E(T('qr.lead'))}</p>
      ${state.localOnly ? `<div class="qr-warn">${E(T('qr.noNet'))}</div>` : ''}
      ${svgFor(url)}
      <code class="qr-url">${E(url)}</code>
      ${state.urls.length > 1 ? `<div class="qr-addrs">${state.urls.map((u, i) => `<button type="button" data-qri="${i}" class="${i === state.i ? 'on' : ''}">${E(new URL(u).host)}</button>`).join('')}</div>` : ''}
      <p style="font-size:.92rem">${E(T('qr.hint'))}</p>
      <div class="qr-actions">
        <button type="button" class="qr-copy">📋 ${E(T('qr.copy'))}</button>
        <button type="button" class="qr-close">✕ ${E(T('qr.close'))}</button>
      </div>
    </div>`;
  }

  async function open(path) {
    ensureDialog();
    state = { urls: [], i: 0, path: path || '/', localOnly: false };
    let urls = [];
    if (!isLocal(location.hostname)) urls.push(location.origin + state.path);
    try {
      const r = await fetch('/api/addresses', { cache: 'no-store' });
      const d = await r.json();
      for (const ip of d.addresses || []) {
        const u = `${location.protocol}//${ip}:${d.port}${state.path}`;
        if (!urls.includes(u)) urls.push(u);
      }
    } catch {}
    if (!urls.length) {
      urls = [location.origin + state.path]; // ネットワークが見つからない（このパソコンからしか開けない）
      state.localOnly = true;
    }
    state.urls = urls;
    render();
    if (!dlg.open) dlg.showModal();
  }

  // data-qr="/u/kaki/" のように、開く場所を書いておく（空なら、いまのページ）
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-qr]');
    if (!el) return;
    e.preventDefault();
    open(el.getAttribute('data-qr') || location.pathname);
  });
  document.addEventListener('keydown', (e) => {
    const el = e.target.closest && e.target.closest('[data-qr]');
    if (el && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      open(el.getAttribute('data-qr') || location.pathname);
    }
  });

  window.KaigoQR = { open };
})();
