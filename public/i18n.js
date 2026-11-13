// 介護日記 — 言語の切りかえ（インターネットなしで動く）
// 文章は public/lang/ の中の、言語ごとのファイル（ja.js / id.js / en.js）にあります。
// 新しい言語を足すときは、ja.js をコピーして訳し、下の LANGS に1行足します。
'use strict';

(function () {
  const LANGS = [
    { code: 'ja', name: '日本語', short: 'JA' },
    { code: 'id', name: 'Bahasa Indonesia', short: 'ID' },
    { code: 'en', name: 'English', short: 'EN' },
  ];
  const STORE_KEY = 'kaigo-lang';
  const dict = (window.KAIGO_LANG = window.KAIGO_LANG || {});
  let lang = 'ja';

  // 標準の「種類」の名前。記録にはこの日本語の名前のまま保存し、表示だけ訳す
  // （そうしないと、言語がちがう人どうしで「ヒヤリ・事故」などを数えられなくなるため）
  const CATS = {
    '食事': 'meal', '水分': 'water', '排泄': 'toilet', '入浴': 'bath', '服薬・薬': 'med', '体調': 'health', '睡眠': 'sleep',
    'ヒヤリ・事故': 'incident', 'レク・活動': 'activity', '家族連絡': 'family', 'その他': 'other', '受診': 'visit',
  };

  const supported = (code) => LANGS.some((l) => l.code === code);

  function readSaved() {
    try {
      return localStorage.getItem(STORE_KEY) || '';
    } catch {
      return '';
    }
  }

  function save(code) {
    try {
      localStorage.setItem(STORE_KEY, code);
    } catch {}
  }

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // 今の言語の文章。なければ日本語、それもなければキーの名前
  function raw(key) {
    const v = (dict[lang] || {})[key];
    if (v !== undefined) return v;
    const j = (dict.ja || {})[key];
    return j !== undefined ? j : key;
  }

  const has = (key) => (dict.ja || {})[key] !== undefined;

  function fill(text, params, escape) {
    return String(text).replace(/\{(\w+)\}/g, (m, k) => (params && k in params ? (escape ? esc(params[k]) : params[k]) : m));
  }

  // t：文字として使うとき（textContent・トースト・確認の文章）
  const t = (key, params) => fill(raw(key), params, false);
  // th：HTMLの中に入れるとき。{名前} などの差しこみは自動で安全にする
  const th = (key, params) => fill(raw(key), params, true);

  function applyStatic(root = document) {
    root.querySelectorAll('[data-i18n]').forEach((el) => (el.textContent = t(el.dataset.i18n)));
    root.querySelectorAll('[data-i18n-html]').forEach((el) => (el.innerHTML = raw(el.dataset.i18nHtml)));
    root.querySelectorAll('[data-i18n-ph]').forEach((el) => (el.placeholder = t(el.dataset.i18nPh)));
    root.querySelectorAll('[data-i18n-title]').forEach((el) => (el.title = t(el.dataset.i18nTitle)));
    root.querySelectorAll('[data-i18n-aria]').forEach((el) => el.setAttribute('aria-label', t(el.dataset.i18nAria)));
  }

  function setLang(code, { persist = true } = {}) {
    if (!supported(code)) code = 'ja';
    lang = code;
    document.documentElement.lang = code;
    if (persist) save(code);
    applyStatic();
  }

  // 使う言語を決める：①アドレスの ?lang=（となりのユニットから来たとき）②この端末に保存した言語
  // ③この端末のブラウザの言語（初めてのとき）④日本語
  function init() {
    let code = '';
    try {
      const p = new URLSearchParams(location.search).get('lang');
      if (p && supported(p)) {
        code = p;
        save(p);
        const u = new URL(location.href);
        u.searchParams.delete('lang');
        history.replaceState(null, '', u.pathname + (u.search || '') + u.hash);
      }
    } catch {}
    if (!code) code = readSaved();
    // 保存も指定もないときは日本語（パソコンのことば設定では決めない）
    if (!supported(code)) code = 'ja';
    setLang(code, { persist: false });
  }

  // 種類の名前の表示（標準の名前だけ訳す。自分で書いた名前はそのまま）
  function catLabel(name) {
    const k = CATS[name];
    return k ? t('cat.' + k) : name;
  }

  // 入力された種類の名前を、保存用の日本語の名前にもどす（どの言語の名前でもOK）
  let reverse = null;
  function catCanonical(text) {
    const s = String(text ?? '').trim();
    if (!reverse) {
      reverse = new Map();
      for (const [ja, k] of Object.entries(CATS)) {
        reverse.set(ja.toLowerCase(), ja);
        for (const code of Object.keys(dict)) {
          const label = (dict[code] || {})['cat.' + k];
          if (label) reverse.set(String(label).toLowerCase(), ja);
        }
      }
    }
    return reverse.get(s.toLowerCase()) || s;
  }

  window.I18N = {
    LANGS,
    get lang() { return lang; },
    has, raw, t, th, esc, init, setLang, applyStatic, catLabel, catCanonical,
  };
  window.t = t;
  window.th = th;
})();
