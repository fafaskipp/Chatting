// 介護日記 — 画面の動き
'use strict';

const CATEGORIES = [
  { name: '体調', color: '#c62828' },
  { name: '食事', color: '#ef6c00' },
  { name: '水分', color: '#0277bd' },
  { name: '排泄', color: '#6d4c41' },
  { name: '入浴', color: '#00838f' },
  { name: '服薬', color: '#6a1b9a' },
  { name: '睡眠', color: '#283593' },
  { name: '転倒・事故', color: '#b71c1c' },
  { name: 'レク・活動', color: '#2e7d32' },
  { name: '家族連絡', color: '#ad1457' },
  { name: 'その他', color: '#616161' },
];
const WEEK = ['日', '月', '火', '水', '木', '金', '土'];

const state = {
  view: 'date',
  range: 'today',
  pickedDate: '',
  selectedPatient: null,
  patients: [],
  version: 0,
  form: { patientId: null, category: 'その他', media: [] },
  uploading: 0,
};

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

// ---------- 共通 ----------

async function api(path, opts = {}) {
  const res = await fetch('/api/' + path, {
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '通信に失敗しました');
  return data;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function ymd(d) {
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return ymd(d);
}

function jpDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  const w = WEEK[new Date(y, m - 1, d).getDay()];
  const label = s === daysAgo(0) ? '（今日）' : s === daysAgo(1) ? '（昨日）' : '';
  return `${y}年${m}月${d}日（${w}）${label}`;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 2500);
}

function catColor(name) {
  return (CATEGORIES.find((c) => c.name === name) || CATEGORIES[CATEGORIES.length - 1]).color;
}

function patientName(id) {
  const p = state.patients.find((x) => x.id === id);
  return p ? p.name : '（削除された利用者）';
}

// ---------- 記録の表示 ----------

function mediaHtml(media, removable) {
  return media
    .map(
      (m, i) => `
      <button type="button" class="media-item" data-src="/uploads/${esc(m.file)}" data-type="${m.type}" title="大きく見る">
        ${m.type === 'video'
          ? `<video src="/uploads/${esc(m.file)}#t=0.1" preload="metadata" muted></video><span class="play">▶</span>`
          : `<img src="/uploads/${esc(m.file)}" loading="lazy" alt="">`}
        ${removable ? `<span class="remove" data-remove="${i}" role="button" aria-label="消す">✕</span>` : ''}
      </button>`
    )
    .join('');
}

function noteHtml(n, showPatient) {
  const patient = n.patientId
    ? `<span class="tag tag-patient">👤 ${esc(patientName(n.patientId))} 様</span>`
    : `<span class="tag tag-none">全体・共有</span>`;
  return `
    <article class="note ${n.important ? 'important' : ''}">
      <div class="note-head">
        ${n.important ? '<span class="tag" style="background:#f9a825;color:#000">⭐ 重要</span>' : ''}
        <span class="note-time">${n.time ? '🕒 ' + esc(n.time) : ''}</span>
        ${showPatient ? patient : ''}
        <span class="tag" style="background:${catColor(n.category)}">${esc(n.category)}</span>
      </div>
      ${n.text ? `<div class="note-text">${esc(n.text)}</div>` : ''}
      ${n.media.length ? `<div class="media-grid">${mediaHtml(n.media, false)}</div>` : ''}
      <div class="note-foot">
        <span>${n.author ? '記入：' + esc(n.author) : ''}</span>
        <span class="actions">
          <button class="btn btn-edit" data-edit="${n.id}">✏️ 直す</button>
          <button class="btn btn-del" data-del="${n.id}">🗑 消す</button>
        </span>
      </div>
    </article>`;
}

function renderNotes(el, notes, showPatient) {
  if (!notes.length) {
    el.innerHTML = '<div class="empty">記録はまだありません。<br>右上の「＋ 記録を書く」から書けます。</div>';
    return;
  }
  let html = '';
  let lastDate = '';
  for (const n of notes) {
    if (n.date !== lastDate) {
      html += `<h3 class="day-head">${jpDate(n.date)}</h3>`;
      lastDate = n.date;
    }
    html += noteHtml(n, showPatient);
  }
  el.innerHTML = html;
}

async function loadDateView() {
  const q = new URLSearchParams();
  if (state.pickedDate) {
    q.set('from', state.pickedDate);
    q.set('to', state.pickedDate);
  } else if (state.range === 'today') q.set('from', daysAgo(0));
  else if (state.range === 'yesterday') {
    q.set('from', daysAgo(1));
    q.set('to', daysAgo(1));
  } else if (state.range === 'week') q.set('from', daysAgo(6));
  else if (state.range === 'month') q.set('from', daysAgo(30));
  const kw = $('#date-search').value.trim();
  if (kw) q.set('q', kw);
  if ($('#date-important').checked) q.set('important', '1');
  renderNotes($('#date-list'), await api('notes?' + q), true);
}

function renderPatientButtons() {
  const kw = $('#patient-search').value.trim().toLowerCase();
  const list = state.patients.filter((p) => !kw || `${p.name} ${p.kana}`.toLowerCase().replace(/\s/g, '').includes(kw.replace(/\s/g, '')));
  const box = $('#patient-buttons');
  if (!state.patients.length) {
    box.innerHTML = '<div class="empty">利用者がまだ登録されていません。「⚙️ 利用者の登録」から追加してください。</div>';
    return;
  }
  box.innerHTML =
    list
      .map(
        (p) => `<button class="pbtn ${state.selectedPatient === p.id ? 'active' : ''}" data-pid="${p.id}">
          ${esc(p.name)}<small>${esc(p.kana)}${p.room ? '　' + esc(p.room) + '号室' : ''}</small></button>`
      )
      .join('') +
    `<button class="pbtn ${state.selectedPatient === 'none' ? 'active' : ''}" data-pid="none">全体・共有<small>利用者なしの記録</small></button>`;
  if (kw && list.length === 1 && state.selectedPatient !== list[0].id) {
    selectPatient(list[0].id);
  }
}

async function loadPatientView() {
  renderPatientButtons();
  const head = $('#patient-head');
  const listEl = $('#patient-list');
  if (!state.selectedPatient) {
    head.innerHTML = '';
    listEl.innerHTML = '<div class="empty">上の名前のボタンを押すと、その人の記録だけが表示されます。</div>';
    return;
  }
  const p = state.patients.find((x) => x.id === state.selectedPatient);
  head.innerHTML = p
    ? `<h2>👤 ${esc(p.name)} 様の記録</h2>${p.memo ? `<div class="patient-memo">📌 ${esc(p.memo)}</div>` : ''}`
    : '<h2>全体・共有の記録</h2>';
  renderNotes(listEl, await api('notes?patientId=' + encodeURIComponent(state.selectedPatient)), false);
}

function selectPatient(id) {
  state.selectedPatient = id;
  loadPatientView().catch((e) => toast(e.message));
}

// ---------- 利用者の登録 ----------

function renderManage() {
  const el = $('#manage-list');
  el.innerHTML = state.patients.length
    ? state.patients
        .map(
          (p) => `<div class="manage-item">
            <div><div class="name">${esc(p.name)} 様</div>
              <div class="sub">${esc(p.kana)}${p.room ? '　' + esc(p.room) + '号室' : ''}${p.memo ? '<br>📌 ' + esc(p.memo) : ''}</div></div>
            <div class="actions">
              <button class="btn btn-edit" data-pedit="${p.id}">✏️ 直す</button>
              <button class="btn btn-del" data-pdel="${p.id}">🗑 消す</button>
            </div></div>`
        )
        .join('')
    : '<div class="empty">まだ登録されていません。</div>';
}

function resetPatientForm() {
  const f = $('#patient-form');
  f.reset();
  f.id.value = '';
  $('#pform-title').textContent = '利用者を追加する';
  $('#pform-cancel').hidden = true;
}

async function loadPatients() {
  state.patients = await api('patients');
}

// ---------- 記録の入力 ----------

function renderFormChoices() {
  const pBox = $('#nform-patients');
  pBox.innerHTML =
    state.patients
      .map((p) => `<button type="button" class="choice ${state.form.patientId === p.id ? 'active' : ''}" data-fpid="${p.id}">${esc(p.name)}<small>${esc(p.kana)}</small></button>`)
      .join('') +
    `<button type="button" class="choice ${!state.form.patientId ? 'active' : ''}" data-fpid="">全体・共有<small>特定の人ではない</small></button>`;
  $('#nform-categories').innerHTML = CATEGORIES.map(
    (c) =>
      `<button type="button" class="choice ${state.form.category === c.name ? 'active' : ''}" data-fcat="${c.name}"
        style="border-color:${c.color};${state.form.category === c.name ? `background:${c.color};color:#fff` : `color:${c.color}`}">${c.name}</button>`
  ).join('');
  $('#nform-media').innerHTML = mediaHtml(state.form.media, true);
}

function openNoteForm(note) {
  const f = $('#note-form');
  f.reset();
  $('#nform-error').hidden = true;
  const now = new Date();
  if (note) {
    $('#nform-title').textContent = '記録を直す';
    f.id.value = note.id;
    f.date.value = note.date;
    f.time.value = note.time;
    f.text.value = note.text;
    f.author.value = note.author;
    f.important.checked = note.important;
    state.form = { patientId: note.patientId, category: note.category, media: [...note.media] };
  } else {
    $('#nform-title').textContent = '記録を書く';
    f.id.value = '';
    f.date.value = ymd(now);
    f.time.value = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    f.author.value = localStorage.getItem('author') || '';
    const pid = state.view === 'patient' && state.selectedPatient !== 'none' ? state.selectedPatient : null;
    state.form = { patientId: pid, category: 'その他', media: [] };
  }
  renderFormChoices();
  $('#note-dialog').showModal();
}

function uploadFile(file) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload');
    xhr.setRequestHeader('X-Filename', encodeURIComponent(file.name));
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) $('#nform-progress').textContent = `アップロード中… ${file.name}（${Math.round((e.loaded / e.total) * 100)}%）`;
    };
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch {}
      xhr.status < 300 ? resolve(data) : reject(new Error(data.error || 'アップロードに失敗しました'));
    };
    xhr.onerror = () => reject(new Error('アップロードに失敗しました'));
    xhr.send(file);
  });
}

async function addFiles(files) {
  const prog = $('#nform-progress');
  const save = $('#nform-save');
  state.uploading++;
  save.disabled = true;
  prog.hidden = false;
  try {
    for (const file of files) {
      try {
        state.form.media.push(await uploadFile(file));
        renderFormChoices();
      } catch (e) {
        toast(e.message);
      }
    }
  } finally {
    state.uploading--;
    if (!state.uploading) {
      save.disabled = false;
      prog.hidden = true;
    }
  }
}

async function saveNote(e) {
  e.preventDefault();
  const f = $('#note-form');
  const body = {
    date: f.date.value,
    time: f.time.value,
    patientId: state.form.patientId,
    category: state.form.category,
    text: f.text.value,
    author: f.author.value,
    important: f.important.checked,
    media: state.form.media,
  };
  localStorage.setItem('author', body.author);
  try {
    if (f.id.value) await api('notes/' + f.id.value, { method: 'PUT', body });
    else await api('notes', { method: 'POST', body });
    $('#note-dialog').close();
    toast('保存しました ✅');
    refresh();
  } catch (err) {
    const el = $('#nform-error');
    el.textContent = err.message;
    el.hidden = false;
  }
}

// ---------- 画面の切りかえ・更新 ----------

async function refresh() {
  try {
    const v = await api('version');
    state.version = v.version;
    await loadPatients();
    if (state.view === 'date') await loadDateView();
    else if (state.view === 'patient') await loadPatientView();
    else renderManage();
  } catch (e) {
    toast(e.message);
  }
}

function showView(view) {
  state.view = view;
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === view));
  $$('.view').forEach((v) => (v.hidden = v.id !== 'view-' + view));
  refresh();
}

// 他のパソコンで書かれた記録を自動で反映（入力中は更新しない）
async function poll() {
  if (document.hidden || $('#note-dialog').open) return;
  try {
    const v = await api('version');
    if (v.version !== state.version) refresh();
  } catch {}
}

// ---------- イベント ----------

$$('.tab').forEach((t) => t.addEventListener('click', () => showView(t.dataset.view)));
$('#btn-new').addEventListener('click', () => openNoteForm(null));

$$('[data-range]').forEach((b) =>
  b.addEventListener('click', () => {
    state.range = b.dataset.range;
    state.pickedDate = '';
    $('#date-pick').value = '';
    $$('[data-range]').forEach((x) => x.classList.toggle('active', x === b));
    loadDateView().catch((e) => toast(e.message));
  })
);
$('#date-pick').addEventListener('change', (e) => {
  state.pickedDate = e.target.value;
  $$('[data-range]').forEach((x) => x.classList.toggle('active', !state.pickedDate && x.dataset.range === state.range));
  loadDateView().catch((e) => toast(e.message));
});
let searchTimer;
$('#date-search').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => loadDateView().catch((e) => toast(e.message)), 300);
});
$('#date-important').addEventListener('change', () => loadDateView().catch((e) => toast(e.message)));

$('#patient-search').addEventListener('input', renderPatientButtons);
$('#patient-buttons').addEventListener('click', (e) => {
  const b = e.target.closest('[data-pid]');
  if (b) selectPatient(b.dataset.pid);
});

// 記録の「直す」「消す」・写真の拡大
document.addEventListener('click', async (e) => {
  const edit = e.target.closest('[data-edit]');
  const del = e.target.closest('[data-del]');
  const media = e.target.closest('.media-item');
  if (edit) {
    try { openNoteForm(await api('notes/' + edit.dataset.edit)); } catch (err) { toast(err.message); }
  } else if (del) {
    if (!confirm('この記録を消しますか？\n（元に戻せません）')) return;
    try {
      await api('notes/' + del.dataset.del, { method: 'DELETE' });
      toast('消しました');
      refresh();
    } catch (err) { toast(err.message); }
  } else if (media && !e.target.closest('[data-remove]')) {
    const src = media.dataset.src;
    $('#viewer-body').innerHTML = media.dataset.type === 'video'
      ? `<video src="${src}" controls autoplay playsinline></video>`
      : `<img src="${src}" alt="">`;
    $('#viewer').showModal();
  }
});

$('#viewer-close').addEventListener('click', () => $('#viewer').close());
$('#viewer').addEventListener('close', () => ($('#viewer-body').innerHTML = ''));

// 入力画面
$('#note-form').addEventListener('submit', saveNote);
$('#nform-cancel').addEventListener('click', () => $('#note-dialog').close());
$('#nform-files').addEventListener('change', (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  if (files.length) addFiles(files);
});
$('#note-form').addEventListener('click', (e) => {
  const p = e.target.closest('[data-fpid]');
  const c = e.target.closest('[data-fcat]');
  const r = e.target.closest('[data-remove]');
  if (p) state.form.patientId = p.dataset.fpid || null;
  else if (c) state.form.category = c.dataset.fcat;
  else if (r) {
    e.preventDefault();
    e.stopPropagation();
    state.form.media.splice(Number(r.dataset.remove), 1);
  } else return;
  renderFormChoices();
});

// 利用者フォーム
$('#patient-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const body = { name: f.name.value, kana: f.kana.value, room: f.room.value, memo: f.memo.value };
  try {
    if (f.id.value) await api('patients/' + f.id.value, { method: 'PUT', body });
    else await api('patients', { method: 'POST', body });
    toast('保存しました ✅');
    resetPatientForm();
    refresh();
  } catch (err) { toast(err.message); }
});
$('#pform-cancel').addEventListener('click', resetPatientForm);
$('#manage-list').addEventListener('click', async (e) => {
  const edit = e.target.closest('[data-pedit]');
  const del = e.target.closest('[data-pdel]');
  if (edit) {
    const p = state.patients.find((x) => x.id === edit.dataset.pedit);
    const f = $('#patient-form');
    f.id.value = p.id;
    f.name.value = p.name;
    f.kana.value = p.kana;
    f.room.value = p.room;
    f.memo.value = p.memo;
    $('#pform-title').textContent = `${p.name} 様の情報を直す`;
    $('#pform-cancel').hidden = false;
    f.scrollIntoView({ behavior: 'smooth' });
  } else if (del) {
    const p = state.patients.find((x) => x.id === del.dataset.pdel);
    if (!confirm(`${p.name} 様を消しますか？`)) return;
    try {
      await api('patients/' + p.id, { method: 'DELETE' });
      if (state.selectedPatient === p.id) state.selectedPatient = null;
      toast('消しました');
      refresh();
    } catch (err) { toast(err.message); }
  }
});

// 他の端末からの接続先を表示
api('info')
  .then((info) => {
    const urls = info.addresses.map((ip) => `<code>http://${ip}:${info.port}</code>`).join('<br>');
    $('#server-info').innerHTML = `💻 ほかのパソコン・タブレットからは、同じWi-Fiにつないで次のアドレスを開いてください：<br>${urls || '（ネットワークが見つかりません）'}`;
  })
  .catch(() => {});

refresh();
setInterval(poll, 10000);
