'use strict';
// ログイン：アカウントのボタンをえらんで、パスワードを入れる（IDを打たなくてよい）
let accounts = [];
let chosen = null;

function render() {
  I18N.applyStatic();
  document.documentElement.lang = I18N.lang;
  document.title = t('login.title') + ' — ' + t('app.name');
  renderLangs(render);
  $('#lead').hidden = Boolean(chosen);
  $('#pick').hidden = Boolean(chosen);
  $('#form').hidden = !chosen;
  if (chosen) {
    $('#chosen').innerHTML = `${accountIcon(chosen)}<h2>${esc(chosen.name)}</h2>`;
    return;
  }
  const btn = (a) => `<button type="button" class="unit ${a.role === 'unit' ? '' : 'staff'}" style="${a.color ? `--c:${esc(a.color)}` : ''}" data-id="${esc(a.id)}">
      ${accountIcon(a)}<span class="name">${esc(a.name)}</span></button>`;
  const unitAccounts = accounts.filter((a) => a.role === 'unit');
  const staff = accounts.filter((a) => a.role !== 'unit');
  $('#pick').innerHTML = accounts.length
    ? `<div class="group-title">${th('login.units')}</div><div class="grid">${unitAccounts.map(btn).join('')}</div>
       <div class="group-title">${th('login.staff')}</div><div class="grid">${staff.map(btn).join('')}</div>`
    : '';
  $('#msg').hidden = accounts.length > 0;
  if (!accounts.length) $('#msg').textContent = t('launcher.loadFail');
}

function choose(a) {
  chosen = a;
  $('#error').hidden = true;
  $('#password').value = '';
  render();
  if (a) $('#password').focus();
}

$('#pick').addEventListener('click', (e) => {
  const b = e.target.closest('[data-id]');
  if (b) choose(accounts.find((a) => a.id === b.dataset.id));
});
$('#back').addEventListener('click', () => choose(null));

$('#form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const button = e.target.querySelector('button[type=submit]');
  button.disabled = true;
  try {
    const r = await rootApi('login', { method: 'POST', body: { id: chosen.id, password: $('#password').value }, noRedirect: true });
    location.href = r.home;
  } catch (err) {
    $('#error').textContent = err.message;
    $('#error').hidden = false;
    $('#password').select();
  } finally {
    button.disabled = false;
  }
});

I18N.init();
render();
rootApi('accounts/public', { noRedirect: true })
  .then((list) => {
    accounts = list;
    render();
  })
  .catch(() => render());
