'use strict';
// ホーム（ユニットえらび）：8つのユニットのボタン。記録はユニットごとに別々に保存される。
// ・ユニットのアカウント：自分のユニットは書ける。ほかのユニットは見るだけ
// ・看護師・ケアマネジャー：アカウントの設定ボタンと、今日の大事なこと（全ユニット）が出る
let units = [];
let me = null;
let today = [];

const trText = (n) => (I18N.lang !== 'ja' && n.tr && n.tr[I18N.lang] && n.tr[I18N.lang].text) || n.text;

function render() {
  I18N.applyStatic();
  document.documentElement.lang = I18N.lang;
  document.title = t('app.name');
  renderLangs(render);
  if (!me) return;
  const staff = me.role !== 'unit';
  $('#who').innerHTML = `<span class="me">👤 ${th('home.who', { name: me.name })}</span>
    <span style="display:flex;gap:8px;flex-wrap:wrap">
      ${staff ? `<a class="btn sub" href="account.html">${th('acct.button')}</a>` : ''}
      <button type="button" class="btn sub" id="logout">${th('auth.logout')}</button>
    </span>`;
  $('#warn').innerHTML = me.mustChange
    ? `<div class="warn">${th('auth.mustChange')} <a href="${staff ? 'account.html' : `u/${encodeURIComponent(me.unit)}/#account`}">${th('auth.changeLink')}</a></div>`
    : '';
  $('#msg').hidden = units.length > 0;
  if (!units.length) $('#msg').textContent = t('launcher.loadFail');
  $('#units').innerHTML = units
    .map((u) => {
      const own = me.unit === u.id;
      const role = staff ? '' : `<span class="role">${own ? th('home.own') : '👀 ' + th('home.viewOnly')}</span>`;
      return `<a class="unit ${own ? 'own' : ''}" style="--c:${esc(u.color)}" href="u/${encodeURIComponent(u.id)}/">
        ${fruitSvg(u)}<span class="name">${esc(u.name)}</span>${role}
        <span class="stat">${u.today ? esc(t('launcher.today', { n: u.today })) : ''}${u.important ? `<span class="badge">⭐ ${u.important}</span>` : ''}</span></a>`;
    })
    .join('');
  $('#staff').innerHTML = staff
    ? `<div class="card"><h2>${th('home.todayTitle')}</h2>${
        today.length
          ? today
              .map(
                (n) => `<a class="today-item" href="u/${encodeURIComponent(n.unit)}/" style="--c:${esc(n.color)}">
                  <span class="u">${esc(n.unitName)}</span>
                  <span class="meta">${n.time ? '🕒 ' + esc(n.time) + '　' : ''}${n.incident ? '⚠️ ' : ''}${n.important ? '⭐ ' : ''}${esc(I18N.catLabel(n.category))}${n.patient ? '　👤 ' + th('patient.person', { name: n.patient }) : ''}</span>
                  <span class="txt">${esc(trText(n))}</span></a>`
              )
              .join('')
          : `<p class="lead">${th('home.todayNone')}</p>`
      }</div>`
    : '';
}

async function load() {
  try {
    if (!me) me = await rootApi('me');
    units = await rootApi('units');
    if (me.role !== 'unit') today = await rootApi('overview');
  } catch {
    units = [];
  }
  render();
}

document.addEventListener('click', (e) => {
  if (e.target.closest('#logout')) logout();
});

I18N.init();
render();
load();
setInterval(load, 15000);
