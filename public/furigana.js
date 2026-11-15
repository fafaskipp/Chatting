// ふりがな（漢字の上に読みがなを出す）— インターネットなしで動く。ボタンで入/切。
// ・読みの辞書は kuromoji（Apache-2.0）と IPADIC。public/furigana/ に入っていて、入にしたときだけ読みこむ（約18MB）
// ・画面に出た日本語の漢字に、自動で <ruby> をつける。入/切は端末ごとに覚える
// ・使いかた：<button id="btn-furi"> を置いて、このファイルを読みこむだけ（ほかのプログラムの変更は不要）
'use strict';

(function () {
  const KEY = 'kaigo-furigana';
  const KANJI = /[㐀-鿿々〆ヶ]/;
  const KANJI_G = /[㐀-鿿々〆ヶ]/g;
  // ふりがなをつけない場所（入力欄・選ぶ欄・プログラム・もうつけた所）
  const SKIP = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'SCRIPT', 'STYLE', 'RT', 'RP', 'RUBY', 'CODE', 'PRE', 'SVG']);

  let on = false;
  let tokenizer = null;
  let loading = null;
  let observer = null;
  let busy = false;
  const cache = new Map(); // 文字列 → 読みつきの分けかた

  const root = document.documentElement;
  const btn = () => document.getElementById('btn-furi');

  function readSaved() {
    try {
      return localStorage.getItem(KEY) === '1';
    } catch {
      return false;
    }
  }
  function save(v) {
    try {
      localStorage.setItem(KEY, v ? '1' : '0');
    } catch {}
  }

  const toHira = (s) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('script'));
      document.head.appendChild(s);
    });
  }

  // 辞書を読みこむ（はじめて「入」にしたときだけ。数秒かかる）
  function load() {
    if (tokenizer) return Promise.resolve(tokenizer);
    if (loading) return loading;
    loading = loadScript('furigana/kuromoji.js')
      .then(
        () =>
          new Promise((resolve, reject) => {
            window.kuromoji.builder({ dicPath: 'furigana/dict/' }).build((err, t) => (err ? reject(err) : resolve(t)));
          })
      )
      .then((t) => {
        tokenizer = t;
        return t;
      })
      .finally(() => {
        loading = null;
      });
    return loading;
  }

  // 1つの言葉（例：食べ / 読み タベ）を、漢字の部分だけに読みをつけるよう分ける
  // 前や後ろについている ひらがな（送りがな）は、読みから外す
  function splitToken(surface, readingKata) {
    const reading = toHira(readingKata);
    let head = 0;
    while (head < surface.length - 1 && !KANJI.test(surface[head]) && toHira(surface[head]) === reading[head]) head++;
    let tail = 0;
    while (
      tail < surface.length - head - 1 &&
      !KANJI.test(surface[surface.length - 1 - tail]) &&
      toHira(surface[surface.length - 1 - tail]) === reading[reading.length - 1 - tail]
    )
      tail++;
    const base = surface.slice(head, surface.length - tail);
    const rt = reading.slice(head, reading.length - tail);
    const out = [];
    if (head) out.push({ t: surface.slice(0, head) });
    if (base) out.push({ t: base, r: rt });
    if (tail) out.push({ t: surface.slice(surface.length - tail) });
    return out;
  }

  function analyze(text) {
    if (cache.has(text)) return cache.get(text);
    const parts = [];
    for (const tok of tokenizer.tokenize(text)) {
      const s = tok.surface_form;
      const r = tok.reading;
      if (!KANJI.test(s) || !r || r === '*') parts.push({ t: s });
      else if (toHira(r) === s) parts.push({ t: s });
      else parts.push(...splitToken(s, r));
    }
    if (cache.size > 3000) cache.clear();
    cache.set(text, parts);
    return parts;
  }

  function processText(node) {
    const text = node.nodeValue;
    if (!KANJI.test(text)) return;
    const frag = document.createDocumentFragment();
    for (const p of analyze(text)) {
      if (p.r) {
        const ruby = document.createElement('ruby');
        ruby.setAttribute('data-fg', '');
        ruby.appendChild(document.createTextNode(p.t));
        const rt = document.createElement('rt');
        rt.textContent = p.r;
        ruby.appendChild(rt);
        frag.appendChild(ruby);
      } else frag.appendChild(document.createTextNode(p.t));
    }
    node.parentNode.replaceChild(frag, node);
  }

  function skipped(el) {
    for (let e = el; e && e !== document.body; e = e.parentElement) {
      if (SKIP.has(e.tagName.toUpperCase()) || e.hasAttribute('data-nofurigana') || e.isContentEditable) return true;
    }
    return false;
  }

  function processTree(node) {
    if (!tokenizer || !on) return;
    if (node.nodeType === 3) {
      if (node.parentElement && !skipped(node.parentElement)) processText(node);
      return;
    }
    if (node.nodeType !== 1 || skipped(node)) return;
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (KANJI.test(n.nodeValue) && n.parentElement && !skipped(n.parentElement) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
    });
    const list = [];
    while (walker.nextNode()) list.push(walker.currentNode);
    list.forEach(processText);
  }

  // 画面が書きかわるたびに、新しく出た部分にだけふりがなをつける
  function startObserver() {
    if (observer) return;
    let queue = [];
    let timer = 0;
    observer = new MutationObserver((records) => {
      if (busy || !on) return;
      for (const r of records) {
        if (r.type === 'childList') r.addedNodes.forEach((n) => queue.push(n));
        else if (r.type === 'characterData') queue.push(r.target);
      }
      clearTimeout(timer);
      timer = setTimeout(() => {
        const nodes = queue;
        queue = [];
        busy = true;
        try {
          nodes.forEach((n) => n.isConnected && processTree(n));
        } finally {
          observer.takeRecords(); // 自分で書きかえた分は、もう一度やらない
          busy = false;
        }
      }, 30);
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  function paint() {
    root.classList.toggle('furigana-on', on);
    const b = btn();
    if (b) {
      b.setAttribute('aria-pressed', String(on));
      b.classList.toggle('active', on);
    }
  }

  async function setOn(v) {
    save(v);
    if (!v) {
      on = false;
      paint();
      return;
    }
    const b = btn();
    if (b) {
      b.disabled = true;
      b.classList.add('loading');
    }
    try {
      await load();
      on = true;
      paint();
      startObserver();
      busy = true;
      try {
        processTree(document.body);
      } finally {
        observer && observer.takeRecords();
        busy = false;
      }
    } catch {
      on = false;
      save(false);
      paint();
      const msg = (window.I18N && window.I18N.t && window.I18N.t('furigana.failed')) || 'Furigana could not be loaded';
      const toast = document.getElementById('toast');
      if (toast) {
        toast.textContent = msg;
        toast.hidden = false;
        setTimeout(() => (toast.hidden = true), 3000);
      }
    } finally {
      if (b) {
        b.disabled = false;
        b.classList.remove('loading');
      }
    }
  }

  function init() {
    const b = btn();
    if (b) b.addEventListener('click', () => setOn(!on));
    paint();
    if (readSaved()) setOn(true);
  }

  window.Furigana = { setOn, isOn: () => on };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
