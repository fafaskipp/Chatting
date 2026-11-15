'use strict';
// ホーム（ユニットえらび）：8つのユニットのボタン。記録はユニットごとに別々に保存される。
// ・ユニットのアカウント：自分のユニットは書ける。ほかのユニットは見るだけ
// ・看護師・ケアマネジャー：アカウントの設定ボタンと、今日の大事なこと（全ユニット）が出る
let units = [];
let me = null;
let week = { days: [], items: [] };
let unitFilter = ''; // 「この1週間」を1つのユニットだけにしぼる（空＝全ユニット）

const trText = (n) => (I18N.lang !== 'ja' && n.tr && n.tr[I18N.lang] && n.tr[I18N.lang].text) || n.text;

// 日付の見出し（例：11月15日（日）　今日）
function dayLabel(ymd, i) {
  const [y, m, d] = ymd.split('-').map(Number);
  const w = new Date(y, m - 1, d).getDay();
  const full = t('date.full', { y, m, d, M: I18N.raw('date.months')[m - 1], w: I18N.raw('date.weekdays')[w] });
  return full + (i === 0 ? t('date.labelToday') : i === 1 ? t('date.labelYesterday') : '');
}

function weekHtml() {
  const items = unitFilter ? week.items.filter((n) => n.unit === unitFilter) : week.items;
  const inc = items.filter((n) => n.incident).length;
  const chips = [{ id: '', name: t('home.allUnits') }, ...units].map(
    (u) => `<button type="button" class="ufilter ${unitFilter === u.id ? 'on' : ''}" data-ufilter="${esc(u.id)}" style="${u.color ? `--c:${esc(u.color)}` : ''}">${esc(u.name)}</button>`
  );
  const days = week.days
    .map((day, i) => {
      const list = items.filter((n) => n.date === day);
      return `<section class="day">
        <h3 class="day-h">${esc(dayLabel(day, i))}<span class="day-n">${list.length ? esc(t('bars.count', { n: list.length })) : ''}</span></h3>
        ${
          list.length
            ? list
                .map(
                  (n) => `<a class="today-item ${n.incident ? 'inc' : ''}" href="u/${encodeURIComponent(n.unit)}/" style="--c:${esc(n.color)}">
                  <span class="u">${esc(n.unitName)}</span>
                  <span class="meta">${n.time ? '🕒 ' + esc(n.time) + '　' : ''}${n.incident ? '⚠️ ' : ''}${n.important ? '⭐ ' : ''}${esc(I18N.catLabel(n.category))}${n.patient ? '　👤 ' + th('patient.person', { name: n.patient }) : ''}</span>
                  <span class="txt">${esc(trText(n))}${n.author ? `<small>${th('note.author', { name: n.author })}</small>` : ''}</span></a>`
                )
                .join('')
            : `<p class="day-none">${th('home.dayNone')}</p>`
        }
      </section>`;
    })
    .join('');
  return `<div class="card week"><h2>${th('home.weekTitle')}</h2>
    <p class="lead">${th('home.weekLead', { n: items.length, inc })}</p>
    <div class="ufilters">${chips.join('')}</div>${days}</div>`;
}

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
  $('#staff').innerHTML = staff ? weekHtml() : '';
}

async function load() {
  try {
    if (!me) me = await rootApi('me');
    units = await rootApi('units');
    if (me.role !== 'unit') week = await rootApi('overview');
  } catch {
    units = [];
  }
  render();
}

document.addEventListener('click', (e) => {
  if (e.target.closest('#logout')) logout();
  const f = e.target.closest('[data-ufilter]');
  if (f) {
    unitFilter = f.dataset.ufilter;
    render();
  }
});

I18N.init();
render();
load();
setInterval(load, 15000);
