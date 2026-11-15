'use strict';
// アカウントの設定：自分のパスワードを変える。ケアマネジャー（管理者）は、全アカウントの名前とパスワードも変えられる
let me = null;
let list = [];
const MIN = 4;

function render() {
  I18N.applyStatic();
  document.documentElement.lang = I18N.lang;
  document.title = t('acct.title') + ' — ' + t('app.name');
  renderLangs(render);
  $('#next-label').textContent = t('acct.next', { n: MIN });
  if (!me) return;
  $('#who').innerHTML = `<a class="btn sub" href="${me.role === 'unit' ? `/u/${encodeURIComponent(me.unit)}/` : '/'}">${th('acct.back')}</a>
    <span class="me">👤 ${th('home.who', { name: me.name })}</span>`;
  $('#own-id').textContent = t('acct.ownHint', { id: me.id });
  $('#admin').innerHTML =
    me.role === 'care'
      ? `<div class="card"><h2>${th('acct.all')}</h2><p class="lead">${th('acct.allHint')}</p>${list
          .map(
            (a) => `<form class="acct" data-id="${esc(a.id)}" autocomplete="off">
              <span class="id">${esc(a.id)}${a.mustChange ? `<small>⚠️ ${th('acct.default')}</small>` : ''}</span>
              <input name="name" value="${esc(a.name)}" maxlength="40" aria-label="${esc(t('acct.name'))}" required>
              <input name="password" type="text" placeholder="${esc(t('acct.newPw'))}" aria-label="${esc(t('acct.newPw'))}" autocomplete="off" autocapitalize="off" spellcheck="false">
              <button type="submit" class="btn">${th('acct.save')}</button>
            </form>`
          )
          .join('')}</div>`
      : '';
}

async function load() {
  me = await rootApi('me');
  if (me.role === 'care') list = await rootApi('accounts');
  render();
}

$('#own').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const err = $('#own-error');
  err.hidden = true;
  try {
    if (f.next.value !== f.again.value) throw new Error(t('acct.mismatch'));
    me = await rootApi('me/password', { method: 'PUT', body: { current: f.current.value, next: f.next.value } });
    f.reset();
    toast(t('acct.changed'));
    await load();
  } catch (ex) {
    err.textContent = ex.message;
    err.hidden = false;
  }
});

$('#admin').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target.closest('form[data-id]');
  if (!f) return;
  try {
    await rootApi('accounts/' + f.dataset.id, { method: 'PUT', body: { name: f.name.value, password: f.password.value } });
    toast(t('toast.saved'));
    await load();
  } catch (ex) {
    toast(ex.message);
  }
});

I18N.init();
render();
load().catch(() => {});
