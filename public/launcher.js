'use strict';
// ユニットえらび：8つのユニットのボタンを出す。記録はユニットごとに別々に保存される。
const { t, th, esc } = I18N;
const $ = (s) => document.querySelector(s);
let units = [];

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
    <g fill="${esc(u.color)}">${body}</g>
    <ellipse cx="39" cy="54" rx="6" ry="9" fill="#fff" opacity=".45" transform="rotate(-20 39 54)"/>
  </svg>`;
}

function render() {
  I18N.applyStatic();
  document.documentElement.lang = I18N.lang;
  document.title = t('app.name');
  $('#langs').innerHTML = I18N.LANGS.map(
    (l) => `<button type="button" data-lang="${l.code}" lang="${l.code}" aria-pressed="${l.code === I18N.lang}">${esc(l.name)}</button>`
  ).join('');
  $('#msg').hidden = units.length > 0;
  if (!units.length) $('#msg').textContent = t('launcher.loadFail');
  $('#units').innerHTML = units
    .map(
      (u) => `<a class="unit" style="--c:${esc(u.color)}" href="u/${encodeURIComponent(u.id)}/">
        ${fruitSvg(u)}<span class="name">${esc(u.name)}</span>
        <span class="stat">${u.today ? esc(t('launcher.today', { n: u.today })) : ''}${u.important ? `<span class="badge">⭐ ${u.important}</span>` : ''}</span></a>`
    )
    .join('');
}

async function load() {
  try {
    const res = await fetch('api/units', { cache: 'no-store' });
    units = res.ok ? await res.json() : [];
  } catch {
    units = [];
  }
  render();
}

$('#langs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-lang]');
  if (!b) return;
  I18N.setLang(b.dataset.lang);
  render();
});

I18N.init();
render();
load();
setInterval(load, 15000);
