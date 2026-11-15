'use strict';
// ログイン・ホーム・アカウント設定の画面で共通に使うもの
const { t, th, esc } = I18N;
const $ = (s) => document.querySelector(s);

// くだもののイラスト（色と形だけ変える）
function fruitSvg(u) {
  const body = {
    peach: '<path d="M50 30 C24 28 16 58 30 76 C38 86 50 88 50 88 C50 88 62 86 70 76 C84 58 76 28 50 30 Z"/><path d="M50 32 C44 50 46 70 50 86" fill="none" stroke="rgba(0,0,0,.12)" stroke-width="3"/>',
    round: '<circle cx="50" cy="60" r="27"/>',
    persimmon: '<ellipse cx="50" cy="62" rx="31" ry="25"/><path d="M50 38 l-14 -2 8 8 -10 6 13 -1 3 10 3 -10 13 1 -10 -6 8 -8 Z" fill="#5b8c2a"/>',
    oval: '<ellipse cx="50" cy="61" rx="22" ry="27"/>',
    pear: '<path d="M50 30 C40 30 38 44 36 52 C24 60 26 88 50 88 C74 88 76 60 64 52 C62 44 60 30 50 30 Z"/>',
    flat: '<ellipse cx="50" cy="62" rx="31" ry="24"/><circle cx="50" cy="40" r="3" fill="#5b8c2a"/>',
    apple: '<path d="M50 40 C38 30 18 36 20 58 C22 78 38 90 50 84 C62 90 78 78 80 58 C82 36 62 30 50 40 Z"/>',
  }[u.shape] || '<circle cx="50" cy="60" r="27"/>';
  return `<svg viewBox="0 0 100 100" aria-hidden="true">
    <path d="M50 38 C50 30 52 24 56 18" fill="none" stroke="#7a5230" stroke-width="4" stroke-linecap="round"/>
    <path d="M54 24 C64 12 80 14 82 18 C76 28 62 30 54 24 Z" fill="#6aa832"/>
    <g fill="${esc(u.color || '#9ccc3c')}">${body}</g>
    <ellipse cx="39" cy="54" rx="6" ry="9" fill="#fff" opacity=".45" transform="rotate(-20 39 54)"/>
  </svg>`;
}
// アカウントの絵（ユニットはくだもの、看護師・ケアマネジャーは絵文字）
const accountIcon = (a) => (a.role === 'unit' ? fruitSvg(a) : `<span class="emoji" aria-hidden="true">${a.role === 'nurse' ? '🩺' : '📋'}</span>`);

function errorText(data) {
  if (data && data.code && I18N.has('err.' + data.code)) return t('err.' + data.code, data.params);
  return (data && data.error) || t('err.network');
}

// サーバーとのやりとり。ログインが切れていたら、ログイン画面へ
async function rootApi(path, opts = {}) {
  let res;
  try {
    res = await fetch('/api/' + path, {
      method: opts.method || 'GET',
      cache: 'no-store',
      headers: opts.body ? { 'Content-Type': 'application/json' } : {},
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new Error(t('err.network'));
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !opts.noRedirect) {
    location.href = '/login.html';
    throw new Error(errorText(data));
  }
  if (!res.ok) throw new Error(errorText(data));
  return data;
}

async function logout() {
  try {
    await fetch('/api/logout', { method: 'POST' });
  } catch {}
  location.href = '/login.html';
}

function toast(msg) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (el.hidden = true), 2600);
}

// 言語のボタン（#langs があれば出す）。onChange は、言語を変えたあとに画面を書きなおす関数
function renderLangs(onChange) {
  const box = $('#langs');
  if (!box) return;
  box.innerHTML = I18N.LANGS.map(
    (l) => `<button type="button" data-lang="${l.code}" lang="${l.code}" aria-pressed="${l.code === I18N.lang}">${esc(l.name)}</button>`
  ).join('');
  if (!box.dataset.bound) {
    box.dataset.bound = '1';
    box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-lang]');
      if (!b) return;
      I18N.setLang(b.dataset.lang);
      onChange();
    });
  }
}
