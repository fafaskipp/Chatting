// 介護日記 — 画面の動き
// 画面の文章は public/lang/ の中の言語ファイルにあります（t('名前') で取り出します）。
'use strict';

// よく使う種類の色（それ以外は自動で色を決める）。種類の名前は、記録に保存する日本語の名前で書く
const CATEGORY_COLORS = {
  '食事': '#ef6c00',
  '水分': '#0277bd',
  '排泄': '#6d4c41',
  '入浴': '#00838f',
  '服薬・薬': '#6a1b9a',
  '体調': '#c62828',
  '睡眠': '#283593',
  'ヒヤリ・事故': '#b71c1c',
  'レク・活動': '#2e7d32',
  '家族連絡': '#ad1457',
  'その他': '#616161',
};
const AUTO_COLORS = ['#00695c', '#4527a0', '#9e6a00', '#37474f', '#880e4f', '#1565c0', '#558b2f', '#bf360c'];
const PAGE = 50; // 1回に表示する記録の数
const PHOTO_MAX_PX = 1600; // 写真はこの大きさまで縮小して保存

const state = {
  view: 'date',
  range: 'today',
  pickedDate: '',
  selectedPatient: null,
  patients: [],
  unitName: '', // ⚙️ 管理で設定するユニット・部屋の名前
  neighborName: '', // 夜勤で見る、となりのユニットの名前とアドレス
  neighborUrl: '',
  categories: Object.keys(CATEGORY_COLORS),
  slots: 10,
  trashDays: 30,
  addresses: [],
  port: 0,
  version: 0,
  form: { patientId: null, media: [] },
  uploading: 0,
  formToken: 0, // 入力画面を開くたびに変わる（閉じたあとに届いた写真を別の記録に付けないため）
  openTrash: null,
  month: ymd(new Date()).slice(0, 7), // 月間評価・月間まとめで見ている月
  openMonthAll: new Set(), // 月間評価で「すべて見る」を開いている利用者
  calMonth: ymd(new Date()).slice(0, 7), // カレンダーで見ている月
  calDay: ymd(new Date()), // カレンダーでえらんでいる日
  calEvents: [],
  eventForm: { patientId: null, repeat: '' },
  lists: { date: { key: '', count: PAGE }, patient: { key: '', count: PAGE } },
};

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const esc = I18N.esc;
const catLabel = I18N.catLabel;

// ---------- 共通 ----------

// サーバーからのエラーを、今の言語にして返す（コードがなければ、届いた文章のまま）
function errorText(data) {
  if (data && data.code && I18N.has('err.' + data.code)) return t('err.' + data.code, data.params);
  return (data && data.error) || t('err.network');
}

async function api(path, opts = {}) {
  const res = await fetch('/api/' + path, {
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(errorText(data));
  return data;
}

// ブラウザが保存を許可していないとき（Safari のプライベートなど）でも止まらないように
function remember(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key) || '';
    localStorage.setItem(key, value);
  } catch {}
  return '';
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

// 日付・月の書きかたは、言語ごとに言語ファイルで決まる
function fmtDate(s, withLabel = true) {
  const [y, m, d] = s.split('-').map(Number);
  const w = new Date(y, m - 1, d).getDay();
  const label = !withLabel ? '' : s === daysAgo(0) ? t('date.labelToday') : s === daysAgo(1) ? t('date.labelYesterday') : '';
  return t('date.full', { y, m, d, M: I18N.raw('date.months')[m - 1], w: I18N.raw('date.weekdays')[w] }) + label;
}

function fmtDateTime(iso) {
  const d = new Date(iso);
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return t('date.dateTime', { date: fmtDate(ymd(d), false), time });
}

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (el.hidden = true), 2500);
}

function catColor(name) {
  if (CATEGORY_COLORS[name]) return CATEGORY_COLORS[name];
  let h = 0;
  for (const ch of String(name)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return AUTO_COLORS[h % AUTO_COLORS.length];
}

// 画面の上とブラウザのタブに出す名前（未設定なら、今の言語の「介護日記」）
function appName() {
  return state.unitName || t('app.name');
}

function renderUnitName() {
  $('#unit-name').textContent = appName();
  document.title = appName();
}

// 他の言語でも「その言語の名前」で保存・検索できるように、種類の名前を保存用に直す
const toCanonical = (text) => I18N.catCanonical(text);

// ことばを変えたときにも作り直す画面の部分（言語・ユニット名・説明の文章）
function renderStatic() {
  const cur = I18N.LANGS.find((l) => l.code === I18N.lang);
  $('#lang-code').textContent = cur ? cur.short : 'JA';
  renderUnitName();
  $('#slot-hint').innerHTML = th('manage.hint', { n: state.slots });
  $('#trash-hint').innerHTML = th('trash.hint', { n: state.trashDays });
  const urls = state.addresses.map((ip) => `<code>http://${esc(ip)}:${state.port}</code>`).join('<br>');
  $('#server-info').innerHTML = `${esc(t('server.info'))}<br>${urls || esc(t('server.noNet'))}`;
}

// となりのユニットへ行くとき、今の言語も持っていく（アドレスが変わると端末の言語の保存先も変わるため）
function withLang(url) {
  try {
    const u = new URL(url);
    u.searchParams.set('lang', I18N.lang);
    return u.href;
  } catch {
    return url;
  }
}

// となりのユニット（夜勤で2ユニットを見るとき）：「日付」の画面のいちばん下のボタン
function renderNeighbor() {
  const box = $('#neighbor');
  if (!state.neighborUrl) {
    box.innerHTML = '';
    return;
  }
  const name = state.neighborName || t('nb.defaultName');
  box.innerHTML = `<a class="neighbor-btn" href="${esc(withLang(state.neighborUrl))}" target="_blank" rel="noopener">${esc(t('nb.button', { name }))}</a>`;
}

function patientName(id) {
  const p = state.patients.find((x) => x.id === id);
  return p ? p.name : '';
}

// 確認の画面（大きいボタンで「はい／いいえ」を選ぶ）
function askConfirm(message) {
  const dlg = $('#confirm-dialog');
  if (dlg.open) return Promise.resolve(false); // 2回押したときは2回目を無視
  $('#confirm-text').textContent = message;
  dlg.returnValue = '';
  dlg.showModal();
  return new Promise((resolve) => dlg.addEventListener('close', () => resolve(dlg.returnValue === 'yes'), { once: true }));
}

// ---------- 記録の表示 ----------

function mediaHtml(media, removable) {
  return media
    .map(
      (m, i) => `
      <button type="button" class="media-item" data-src="/uploads/${esc(m.file)}" data-type="${m.type}" title="${esc(t('note.mediaView'))}">
        ${m.type === 'video'
          ? `<video src="/uploads/${esc(m.file)}#t=0.1" preload="metadata" muted></video><span class="play">▶</span>`
          : `<img src="/uploads/${esc(m.file)}" loading="lazy" alt="">`}
        ${removable ? `<span class="remove" data-remove="${i}" role="button" aria-label="${esc(t('note.remove'))}">✕</span>` : ''}
      </button>`
    )
    .join('');
}

// mode: 'normal'（直す・消す）, 'readonly'（ボタンなし）, 'trash'（元に戻す・完全に消す）
function noteHtml(n, showPatient, mode = 'normal', nameOverride) {
  const name = nameOverride || patientName(n.patientId);
  const patient = n.patientId
    ? `<span class="tag tag-patient">👤 ${th('patient.person', { name })}</span>`
    : `<span class="tag tag-none">${th('patient.shared')}</span>`;
  const buttons =
    mode === 'normal'
      ? `<button class="btn btn-edit" data-edit="${n.id}">${th('btn.edit')}</button>
         <button class="btn btn-del" data-del="${n.id}">${th('btn.delete')}</button>`
      : mode === 'trash'
        ? `<button class="btn btn-restore" data-nrestore="${n.id}">${th('btn.restore')}</button>
           <button class="btn btn-del" data-npurge="${n.id}">${th('btn.purge')}</button>`
        : '';
  return `
    <article class="note ${n.important ? 'important' : ''}">
      <div class="note-head">
        ${n.important ? `<span class="tag" style="background:#f9a825;color:#000">${th('note.important')}</span>` : ''}
        ${mode === 'trash' ? `<span class="note-time">${esc(fmtDate(n.date, false))}</span>` : ''}
        <span class="note-time">${n.time ? '🕒 ' + esc(n.time) : ''}</span>
        ${showPatient ? patient : ''}
        <span class="tag" style="background:${catColor(n.category)}">${esc(catLabel(n.category))}</span>
      </div>
      ${n.text ? `<div class="note-text">${esc(n.text)}</div>` : ''}
      ${n.media.length ? `<div class="media-grid">${mediaHtml(n.media, false)}</div>` : ''}
      <div class="note-foot">
        <span>${n.author ? th('note.author', { name: n.author }) : ''}</span>
        <span class="actions">${buttons}</span>
      </div>
    </article>`;
}

function notesHtml(notes, showPatient, mode, nameOverride) {
  if (!notes.length) return `<div class="empty">${th('note.empty')}</div>`;
  let html = '';
  let lastDate = '';
  for (const n of notes) {
    if (n.date !== lastDate) {
      html += `<h3 class="day-head">${esc(fmtDate(n.date))}</h3>`;
      lastDate = n.date;
    }
    html += noteHtml(n, showPatient, mode, nameOverride);
  }
  return html;
}

// 今の画面の検索条件（表示・印刷 共通）
function currentQuery() {
  const q = new URLSearchParams();
  if (state.view === 'patient') {
    if (state.selectedPatient) q.set('patientId', state.selectedPatient);
    q.set('from', state.month + '-01');
    q.set('to', state.month + '-31');
    const who = state.selectedPatient === 'none' ? t('title.whoShared') : t('patient.person', { name: patientName(state.selectedPatient) });
    return { q, title: t('title.patient', { app: appName(), who, month: fmtMonth(state.month) }) };
  }
  const range = {
    today: [daysAgo(0), daysAgo(0)],
    yesterday: [daysAgo(1), daysAgo(1)],
    week: [daysAgo(6), daysAgo(0)],
    month: [daysAgo(30), daysAgo(0)],
    all: ['', ''],
  }[state.range];
  let [from, to] = range;
  let label = t('title.range.' + state.range);
  if (state.pickedDate) {
    from = to = state.pickedDate;
    label = fmtDate(state.pickedDate, false);
  }
  if (from) q.set('from', from);
  if (to) q.set('to', to);
  const parts = [label];
  const cat = $('#date-category').value;
  if (cat) {
    q.set('category', cat);
    parts.push(catLabel(cat));
  }
  const kw = $('#date-search').value.trim();
  if (kw) {
    q.set('q', kw);
    parts.push(t('title.keyword', { kw }));
  }
  if ($('#date-important').checked) {
    q.set('important', '1');
    parts.push(t('title.importantOnly'));
  }
  return { q, title: t('title.date', { app: appName(), parts: parts.join(t('title.sep')) }) };
}

// 記録を PAGE 件ずつ表示し、「もっと見る」で続きを読み込む
async function loadPaged(name, el, q, showPatient, emptyHtml) {
  const list = state.lists[name];
  const key = q.toString();
  if (list.key !== key) {
    list.key = key;
    list.count = PAGE;
  }
  q.set('limit', list.count);
  const { notes, total } = await api('notes?' + q);
  const rest = total - notes.length;
  el.innerHTML = notes.length
    ? notesHtml(notes, showPatient, 'normal') +
      (rest > 0 ? `<button class="btn more-btn" data-more="${name}">${th('btn.more', { n: rest })}</button>` : '')
    : emptyHtml;
}

async function loadDateView() {
  const { q } = currentQuery();
  const active = state.pickedDate || $('#date-category').value || $('#date-search').value.trim();
  $('#date-more summary').textContent = t(active ? 'date.moreActive' : 'date.more');
  await loadPaged('date', $('#date-list'), q, true, `<div class="empty">${th('note.emptyFirst')}</div>`);
}

function renderCategoryFilter() {
  const sel = $('#date-category');
  const cur = sel.value;
  sel.innerHTML =
    `<option value="">${esc(t('date.allCategories'))}</option>` +
    state.categories.map((c) => `<option value="${esc(c)}" ${c === cur ? 'selected' : ''}>${esc(catLabel(c))}</option>`).join('');
}

function renderPatientButtons() {
  const kw = $('#patient-search').value.replace(/\s/g, '').toLowerCase();
  const list = state.patients.filter((p) => !kw || `${p.name}${p.kana}`.replace(/\s/g, '').toLowerCase().includes(kw));
  const box = $('#patient-buttons');
  if (!state.patients.length) {
    box.innerHTML = `<div class="empty">${th('patient.none')}</div>`;
    return;
  }
  box.innerHTML =
    list
      .map(
        (p) => `<button class="pbtn ${state.selectedPatient === p.id ? 'active' : ''}" data-pid="${p.id}">
          ${esc(p.name)}<small>${esc(p.kana)}${p.room ? '　' + th('patient.room', { room: p.room }) : ''}</small></button>`
      )
      .join('') +
    (kw ? '' : `<button class="pbtn ${state.selectedPatient === 'none' ? 'active' : ''}" data-pid="none">${th('patient.shared')}<small>${th('patient.sharedSub')}</small></button>`);
  if (kw && list.length === 1 && state.selectedPatient !== list[0].id) selectPatient(list[0].id);
}

async function loadPatientView() {
  if (state.selectedPatient && state.selectedPatient !== 'none' && !state.patients.some((p) => p.id === state.selectedPatient)) {
    state.selectedPatient = null;
  }
  renderPatientButtons();
  const head = $('#patient-head');
  const listEl = $('#patient-list');
  $('#patient-toolbar').hidden = !state.selectedPatient;
  if (!state.selectedPatient) {
    head.innerHTML = '';
    listEl.innerHTML = `<div class="empty">${th('patient.pickHint')}</div>`;
    return;
  }
  const p = state.patients.find((x) => x.id === state.selectedPatient);
  head.innerHTML = p
    ? `<h2>${th('patient.heading', { name: p.name })}</h2>${p.memo ? `<div class="patient-memo">📌 ${esc(p.memo)}</div>` : ''}`
    : `<h2>${th('patient.headingShared')}</h2>`;
  renderMonthNav();
  await loadPaged('patient', listEl, currentQuery().q, false, `<div class="empty">${th('patient.emptyMonth', { month: fmtMonth(state.month) })}</div>`);
}

function selectPatient(id) {
  state.selectedPatient = id;
  loadPatientView().catch((e) => toast(e.message));
}

// ---------- 予定（カレンダー） ----------

const REPEAT_KEYS = ['', 'weekly', 'monthly'];
const repeatLabel = (k) => t('repeat.' + (k || 'none'));

function eventColor(e) {
  return e.patientId ? 'var(--green)' : 'var(--blue)';
}

function eventHtml(e, withDate) {
  const who = e.patientId
    ? `<span class="tag tag-patient">👤 ${th('patient.person', { name: patientName(e.patientId) })}</span>`
    : `<span class="tag" style="background:var(--blue)">${th('event.all')}</span>`;
  return `<div class="event-item">
    <div class="ev-time">${withDate ? esc(t('date.dayOnly', { d: Number(e.date.slice(8, 10)) })) + '<br>' : ''}${e.time ? esc(e.time) : esc(t('event.allDay'))}</div>
    <div class="ev-body">
      <div class="title">${esc(e.title)}</div>
      <div class="chips">${who}${e.repeat ? `<span class="tag tag-none">🔁 ${esc(repeatLabel(e.repeat))}</span>` : ''}</div>
      ${e.memo ? `<div class="text">${esc(e.memo)}</div>` : ''}
    </div>
    <button class="btn btn-edit" data-eedit="${e.id}">${th('btn.edit')}</button>
  </div>`;
}

async function loadCalendar() {
  const [y, m] = state.calMonth.split('-').map(Number);
  $('#cal-label').textContent = fmtMonth(state.calMonth);
  const first = new Date(y, m - 1, 1);
  const start = new Date(y, m - 1, 1 - first.getDay()); // 日曜はじまり
  const weeks = Math.ceil((first.getDay() + new Date(y, m, 0).getDate()) / 7);
  const days = [];
  for (let i = 0; i < weeks * 7; i++) days.push(ymd(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)));
  const events = await api(`events?from=${days[0]}&to=${days[days.length - 1]}`);
  state.calEvents = events;
  const byDay = new Map();
  for (const e of events) (byDay.get(e.date) || byDay.set(e.date, []).get(e.date)).push(e);
  const today = ymd(new Date());

  $('#cal-grid').innerHTML =
    I18N.raw('date.weekdaysShort').map((w, i) => `<div class="cal-head ${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}">${esc(w)}</div>`).join('') +
    days
      .map((d, i) => {
        const list = byDay.get(d) || [];
        const cls = [
          d.slice(0, 7) !== state.calMonth ? 'other' : '',
          d === today ? 'today' : '',
          d === state.calDay ? 'sel' : '',
          i % 7 === 0 ? 'sun' : i % 7 === 6 ? 'sat' : '',
        ].join(' ');
        return `<button type="button" class="cal-cell ${cls}" data-day="${d}">
          <span class="dnum">${Number(d.slice(8, 10))}</span>
          ${list.slice(0, 3).map((e) => `<span class="cal-ev" style="background:${eventColor(e)}">${e.time ? esc(e.time) + ' ' : ''}${esc(e.title)}</span>`).join('')}
          ${list.length > 3 ? `<span class="cal-more">${th('cal.more', { n: list.length - 3 })}</span>` : ''}
        </button>`;
      })
      .join('');

  const dayList = byDay.get(state.calDay) || [];
  $('#cal-day').innerHTML = state.calDay
    ? `<div class="rep-block">
        <div class="area-head"><h3>${th('cal.dayTitle', { date: fmtDate(state.calDay) })}</h3>
          <button class="btn btn-add" style="width:auto" data-eadd="${state.calDay}">${th('cal.addDay')}</button></div>
        ${dayList.length ? dayList.map((e) => eventHtml(e, false)).join('') : `<p class="sub-hint">${th('cal.noDay')}</p>`}
      </div>`
    : '';

  const monthList = events.filter((e) => e.date.slice(0, 7) === state.calMonth);
  $('#cal-list').innerHTML = monthList.length
    ? `<div class="rep-block">${monthList.map((e) => eventHtml(e, true)).join('')}</div>`
    : `<div class="empty">${th('cal.noMonth')}</div>`;
}

// 今日・明日の予定（日付の画面の上に出して、タブに件数を出す）
async function loadReminders() {
  const today = daysAgo(0);
  const tomorrow = daysAgo(-1);
  const list = await api(`events?from=${today}&to=${tomorrow}`);
  const todays = list.filter((e) => e.date === today);
  const badge = $('#cal-badge');
  badge.hidden = !todays.length;
  badge.textContent = todays.length;
  const tomorrows = list.filter((e) => e.date === tomorrow);
  const line = (e) =>
    `<div>•\u2003${e.time ? esc(e.time) + '\u2003' : ''}<b>${esc(e.title)}</b>${e.patientId ? th('reminder.who', { name: t('patient.person', { name: patientName(e.patientId) }) }) : ''}</div>`;
  $('#reminder').innerHTML = list.length
    ? `<div class="reminder">
        ${todays.length ? `<h3>${th('reminder.today', { n: todays.length })}</h3>${todays.map(line).join('')}` : ''}
        ${tomorrows.length ? `<h3 style="margin-top:8px">${th('reminder.tomorrow', { n: tomorrows.length })}</h3>${tomorrows.map(line).join('')}` : ''}
      </div>`
    : '';
}

function renderEventChoices() {
  $('#eform-patients').innerHTML =
    state.patients
      .map((p) => `<button type="button" class="choice ${state.eventForm.patientId === p.id ? 'active' : ''}" data-epid="${p.id}">${esc(p.name)}<small>${esc(p.kana)}</small></button>`)
      .join('') +
    `<button type="button" class="choice ${!state.eventForm.patientId ? 'active' : ''}" data-epid="">${th('event.all')}<small>${th('patient.sharedSub2')}</small></button>`;
  $('#eform-repeat').innerHTML = REPEAT_KEYS
    .map((k) => {
      const on = state.eventForm.repeat === k;
      return `<button type="button" class="cat-chip ${on ? 'active' : ''}" data-erep="${k}" style="color:var(--blue);${on ? 'background:var(--blue)' : ''}">${esc(repeatLabel(k))}</button>`;
    })
    .join('');
  $('#eform-until-wrap').hidden = !state.eventForm.repeat;
  $('#eform-repeat-note').hidden = !(state.eventForm.repeat && $('#event-form').id.value);
}

function openEventForm(e, date) {
  const f = $('#event-form');
  f.reset();
  $('#eform-error').hidden = true;
  f.id.value = e ? e.id : '';
  f.date.value = e ? e.date : date || state.calDay || ymd(new Date());
  f.time.value = e ? e.time : '';
  f.title.value = e ? e.title : '';
  f.until.value = e ? e.until : '';
  f.memo.value = e ? e.memo : '';
  state.eventForm = { patientId: e ? e.patientId : null, repeat: e ? e.repeat : '' };
  $('#eform-title').textContent = t(e ? 'eform.titleEdit' : 'eform.titleAdd');
  $('#eform-delete').hidden = !e;
  renderEventChoices();
  $('#event-dialog').showModal();
}

async function saveEvent(ev) {
  ev.preventDefault();
  const f = $('#event-form');
  const body = {
    date: f.date.value,
    time: f.time.value,
    title: f.title.value,
    patientId: state.eventForm.patientId,
    repeat: state.eventForm.repeat,
    until: f.until.value,
    memo: f.memo.value,
  };
  try {
    if (f.id.value) await api('events/' + f.id.value, { method: 'PUT', body });
    else await api('events', { method: 'POST', body });
    $('#event-dialog').close();
    state.calDay = body.date;
    state.calMonth = body.date.slice(0, 7);
    toast(t('toast.saved'));
    refresh();
  } catch (err) {
    const el = $('#eform-error');
    el.textContent = err.message;
    el.hidden = false;
  }
}

// ---------- 月ごとの表示（月間評価・月間まとめ） ----------

function thisMonth() {
  return ymd(new Date()).slice(0, 7);
}

function fmtMonth(m) {
  const [y, mm] = m.split('-').map(Number);
  return t('date.month', { y, m: mm, M: I18N.raw('date.months')[mm - 1] });
}

function shiftMonth(m, d) {
  const [y, mm] = m.split('-').map(Number);
  return ymd(new Date(y, mm - 1 + d, 1)).slice(0, 7);
}

function renderMonthNav() {
  $$('.month-label').forEach((el) => (el.textContent = fmtMonth(state.month)));
  $$('[data-month="1"]').forEach((b) => (b.disabled = state.month >= thisMonth()));
}

function countChip(icon, key, n, cls) {
  return `<span class="chip ${n ? cls : 'chip-zero'}">${n ? icon + ' ' : ''}${th(key, { n })}</span>`;
}

function miniNoteHtml(n) {
  return `<div class="mini-note" style="border-color:${catColor(n.category)}">
    <span class="when">${esc(fmtDate(n.date, false))} ${esc(n.time)}</span>
    <span class="tag" style="background:${catColor(n.category)}">${esc(catLabel(n.category))}</span>
    ${n.text ? `<div class="text">${esc(n.text)}</div>` : ''}
  </div>`;
}

// 月間評価：利用者ごとに、その月に起きたこと（ヒヤリ・事故と重要な記録）を見るだけ
async function loadMonthEvents() {
  renderMonthNav();
  const s = await api('summary?month=' + state.month);
  const groups = s.groups.filter((g) => g.id !== 'none' || g.notes.length);
  if (!groups.length) {
    $('#rep-body').innerHTML = `<div class="empty">${th('patient.none')}</div>`;
    return;
  }
  $('#rep-body').innerHTML = groups
    .map((g) => {
      const open = state.openMonthAll.has(g.id);
      return `<div class="rep-block ${g.incidents.length ? 'danger' : ''}">
        <div class="area-head">
          <h3>${g.id === 'none' ? th('report.sharedTitle') : th('report.personTitle', { name: t('patient.person', { name: g.name }) })}</h3>
          <div class="chips">
            ${countChip('⚠️', 'chip.incident', g.incidents.length, 'chip-inc')}
            ${countChip('⭐', 'chip.important', g.important.length, 'chip-imp')}
            <span class="chip chip-zero">${th('chip.records', { n: g.notes.length })}</span>
          </div>
        </div>
        ${g.incidents.length ? `<h4>${th('report.incidents')}</h4>${g.incidents.map(miniNoteHtml).join('')}` : ''}
        ${g.important.length ? `<h4>${th('report.importants')}</h4>${g.important.map(miniNoteHtml).join('')}` : ''}
        ${!g.incidents.length && !g.important.length
          ? `<p class="sub-hint">${th(g.notes.length ? 'report.noneSpecial' : 'report.noNotes')}</p>`
          : ''}
        ${g.notes.length
          ? `<button class="btn more-btn no-print" data-mall="${g.id}">${open ? th('btn.collapse') : th('report.viewAll', { n: g.notes.length })}</button>`
          : ''}
        ${open ? `<h4 class="no-print">${th('report.allTitle', { n: g.notes.length })}</h4><div class="no-print">${g.notes.map(miniNoteHtml).join('')}</div>` : ''}
      </div>`;
    })
    .join('');
}

// rows: [[キー, 件数], ...]。labelOf でキーを表示用の文字にする
function barsHtml(title, rows, colorOf, labelOf = (k) => k) {
  if (!rows.length) return '';
  const max = Math.max(1, ...rows.map((r) => r[1]));
  return `<div class="bars"><h3>${esc(title)}</h3>${rows
    .map(
      ([key, n]) => `<div class="bar-row"><span class="bl" title="${esc(labelOf(key))}">${esc(labelOf(key))}</span>
        <span class="bt"><span class="bf" style="width:${(n / max) * 100}%;background:${colorOf ? colorOf(key) : 'var(--blue)'}"></span></span>
        <span class="bn">${th('bars.count', { n })}</span></div>`
    )
    .join('')}</div>`;
}

function summaryTitle() {
  const sel = $('#sum-patient');
  return t('title.summary', { month: fmtMonth(state.month), who: sel.options[sel.selectedIndex]?.text || t('summary.everyone') });
}

// 月間まとめ：その月の件数（種類ごと・利用者ごと）と重要な記録
async function loadSummary() {
  renderMonthNav();
  const patSel = $('#sum-patient');
  const curPatient = patSel.value;
  patSel.innerHTML =
    `<option value="">${esc(t('summary.everyone'))}</option>` +
    state.patients.map((p) => `<option value="${p.id}" ${p.id === curPatient ? 'selected' : ''}>${esc(t('patient.person', { name: p.name }))}</option>`).join('') +
    `<option value="none" ${curPatient === 'none' ? 'selected' : ''}>${esc(t('patient.shared'))}</option>`;
  const s = await api(`summary?month=${state.month}&patientId=${encodeURIComponent(patSel.value)}`);
  let html = `<div class="stats">
      <div class="stat"><div class="num">${s.total}</div><div class="lab">${th('stat.total')}</div></div>
      <div class="stat"><div class="num">${s.incidentCount}</div><div class="lab">${th('stat.incident')}</div></div>
      <div class="stat"><div class="num">${s.importantCount}</div><div class="lab">${th('stat.important')}</div></div>
      <div class="stat"><div class="num">${s.categories[0] ? esc(catLabel(s.categories[0][0])) : '－'}</div><div class="lab">${th('stat.topCategory')}</div></div>
    </div>`;
  if (!s.total) {
    $('#sum-body').innerHTML = html + `<div class="empty">${th('report.noNotes')}</div>`;
    return;
  }
  html += barsHtml(t('bars.category'), s.categories, catColor, catLabel);
  if (!patSel.value) html += barsHtml(t('bars.patient'), s.patients.map((p) => [p.id === 'none' ? t('patient.shared') : p.name, p.count]), () => 'var(--green)');
  html += `<h2>${th('summary.importantHeading', { n: s.important.length })}</h2>`;
  html += s.important.length ? notesHtml(s.important, !patSel.value, 'readonly') : `<div class="empty">${th('summary.importantNone')}</div>`;
  $('#sum-body').innerHTML = html;
}

// ---------- 利用者の管理（枠） ----------

function renderSlots() {
  $('#slot-hint').innerHTML = th('manage.hint', { n: state.slots });
  let html = '';
  for (let i = 1; i <= state.slots; i++) {
    const p = state.patients.find((x) => x.slot === i);
    html += p
      ? `<div class="slot">
          <div class="slot-no">${th('slot.no', { n: i })}</div>
          <div class="name">${th('patient.person', { name: p.name })}</div>
          <div class="sub">${esc(p.kana)}${p.room ? '　' + th('patient.room', { room: p.room }) : ''}${p.memo ? '\n📌 ' + esc(p.memo) : ''}</div>
          <div class="actions">
            <button class="btn btn-edit" data-pedit="${p.id}">${th('slot.edit')}</button>
            <button class="btn btn-del" data-pdel="${p.id}">${th('slot.delete')}</button>
          </div></div>`
      : `<div class="slot empty-slot">
          <div class="slot-no">${th('slot.no', { n: i })}</div>
          <div class="slot-empty-label">${th('slot.empty')}</div>
          <button class="btn btn-add" data-padd="${i}">${th('slot.register')}</button>
        </div>`;
  }
  $('#slot-list').innerHTML = html;
}

function openPatientForm(p, slot) {
  const f = $('#patient-form');
  f.reset();
  $('#pform-error').hidden = true;
  f.id.value = p ? p.id : '';
  f.slot.value = p ? p.slot : slot;
  if (p) {
    f.name.value = p.name;
    f.kana.value = p.kana;
    f.room.value = p.room;
    f.memo.value = p.memo;
  }
  $('#pform-title').textContent = p
    ? t('pform.titleEdit', { slot: p.slot, name: t('patient.person', { name: p.name }) })
    : t('pform.titleNew', { slot });
  $('#patient-dialog').showModal();
}

// ---------- ゴミ箱 ----------

function daysLeft(iso) {
  const d = Math.ceil((new Date(iso) - Date.now()) / 86400000);
  return d <= 1 ? esc(t('trash.leftSoon')) : esc(t('trash.left', { d }));
}

async function loadTrash() {
  const tr = await api('trash');
  const el = $('#trash-body');
  if (!tr.patients.length && !tr.notes.length && !tr.events.length) {
    el.innerHTML = `<div class="empty">${th('trash.empty')}</div>`;
    return;
  }
  const trashedNames = new Map(tr.patients.map((p) => [p.id, p.name]));
  const sep = esc(t('trash.sep'));
  let html = '';
  if (tr.patients.length) {
    html += `<h2>${th('trash.patients')}</h2>`;
    for (const p of tr.patients) {
      const open = state.openTrash === p.id;
      html += `<div class="trash-item">
        <div class="row-head">
          <div><div class="name">${th('patient.person', { name: p.name })}</div>
            <div class="sub">${th('trash.deletedOn', { date: fmtDateTime(p.deletedAt) })}${sep}${th('trash.counts', { n: p.noteCount })}${p.eventCount ? th('trash.countsEvents', { n: p.eventCount }) : ''}</div>
            <div class="sub">${daysLeft(p.expiresAt)}</div></div>
          <div class="actions">
            ${p.noteCount ? `<button class="btn btn-edit" data-tview="${p.id}">${open ? th('btn.collapse') : th('trash.viewNotes')}</button>` : ''}
            <button class="btn btn-restore" data-prestore="${p.id}">${th('btn.restore')}</button>
            <button class="btn btn-del" data-ppurge="${p.id}">${th('btn.purge')}</button>
          </div>
        </div>
        ${open ? `<div class="trash-notes" id="tnotes-${p.id}">${th('trash.loading')}</div>` : ''}
      </div>`;
    }
  }
  if (tr.notes.length) {
    html += `<h2>${th('trash.notes')}</h2>`;
    for (const n of tr.notes) {
      const name = trashedNames.get(n.patientId) || patientName(n.patientId);
      html += `<div class="trash-item"><div class="sub">${th('trash.deletedOnNote', { date: fmtDateTime(n.deletedAt) })}${sep}${daysLeft(n.expiresAt)}</div>${noteHtml(n, true, 'trash', name)}</div>`;
    }
  }
  if (tr.events.length) {
    html += `<h2>${th('trash.events')}</h2>`;
    for (const e of tr.events) {
      html += `<div class="trash-item"><div class="row-head">
          <div><div class="name">${esc(fmtDate(e.date, false))}　${esc(e.title)}</div>
            <div class="sub">${th('trash.deletedOnNote', { date: fmtDateTime(e.deletedAt) })}${sep}${daysLeft(e.expiresAt)}</div></div>
          <div class="actions">
            <button class="btn btn-restore" data-erestore="${e.id}">${th('btn.restore')}</button>
            <button class="btn btn-del" data-epurge="${e.id}">${th('btn.purge')}</button>
          </div>
        </div></div>`;
    }
  }
  el.innerHTML = html;
  if (state.openTrash && trashedNames.has(state.openTrash)) {
    const id = state.openTrash;
    const notes = await api(`notes?trash=1&patientId=${id}`);
    const box = document.getElementById('tnotes-' + id);
    if (box) box.innerHTML = notesHtml(notes, false, 'readonly', trashedNames.get(id));
  }
}

// ---------- 記録の入力 ----------

function renderFormChoices() {
  $('#nform-patients').innerHTML =
    state.patients
      .map((p) => `<button type="button" class="choice ${state.form.patientId === p.id ? 'active' : ''}" data-fpid="${p.id}">${esc(p.name)}<small>${esc(p.kana)}</small></button>`)
      .join('') +
    `<button type="button" class="choice ${!state.form.patientId ? 'active' : ''}" data-fpid="">${th('patient.shared')}<small>${th('patient.sharedSub2')}</small></button>`;
  const cur = toCanonical($('#note-form').category.value);
  $('#nform-categories').innerHTML = state.categories
    .map((c) => {
      const col = catColor(c);
      const on = c === cur;
      return `<button type="button" class="cat-chip ${on ? 'active' : ''}" data-fcat="${esc(c)}" style="color:${col};${on ? `background:${col}` : ''}">${esc(catLabel(c))}</button>`;
    })
    .join('');
  $('#nform-media').innerHTML = mediaHtml(state.form.media, true);
}

function openNoteForm(note) {
  const f = $('#note-form');
  f.reset();
  $('#nform-error').hidden = true;
  const now = new Date();
  if (note) {
    $('#nform-title').textContent = t('nform.titleEdit');
    f.id.value = note.id;
    f.date.value = note.date;
    f.time.value = note.time;
    f.category.value = catLabel(note.category);
    f.text.value = note.text;
    f.author.value = note.author;
    f.important.checked = note.important;
    state.form = { patientId: note.patientId, media: [...note.media] };
  } else {
    $('#nform-title').textContent = t('nform.titleNew');
    f.id.value = '';
    f.date.value = ymd(now);
    f.time.value = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    f.author.value = remember('author');
    const pid = state.view === 'patient' && state.selectedPatient !== 'none' ? state.selectedPatient : null;
    state.form = { patientId: pid, media: [] };
  }
  state.formToken++;
  renderFormChoices();
  $('#note-dialog').showModal();
}

function uploadFile(file) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload');
    xhr.setRequestHeader('X-Filename', encodeURIComponent(file.name));
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) $('#nform-progress').textContent = t('nform.uploading', { name: file.name, p: Math.round((e.loaded / e.total) * 100) });
    };
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch {}
      xhr.status < 300 ? resolve(data) : reject(new Error(data.code || data.error ? errorText(data) : t('err.upload')));
    };
    xhr.onerror = () => reject(new Error(t('err.upload')));
    xhr.send(file);
  });
}

// スマホの写真は大きいので、保存前に縮小して軽くする（失敗したらそのまま送る）
async function shrinkImage(file) {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, PHOTO_MAX_PX / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 800 * 1024) return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.[^.]*$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

async function addFiles(files) {
  const prog = $('#nform-progress');
  const save = $('#nform-save');
  const token = state.formToken;
  state.uploading++;
  save.disabled = true;
  prog.hidden = false;
  try {
    for (const file of files) {
      try {
        const uploaded = await uploadFile(await shrinkImage(file));
        if (token !== state.formToken || !$('#note-dialog').open) break; // 入力画面はもう閉じられた
        state.form.media.push(uploaded);
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
    category: toCanonical(f.category.value), // どの言語の名前で入れても、保存は共通の名前
    text: f.text.value,
    author: f.author.value,
    important: f.important.checked,
    media: state.form.media,
  };
  remember('author', body.author);
  try {
    if (f.id.value) await api('notes/' + f.id.value, { method: 'PUT', body });
    else await api('notes', { method: 'POST', body });
    $('#note-dialog').close();
    toast(t('toast.saved'));
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
    const [patients, categories, settings] = await Promise.all([api('patients'), api('categories'), api('settings')]);
    state.patients = patients;
    state.categories = categories;
    state.unitName = settings.unitName || '';
    state.neighborName = settings.neighborName || '';
    state.neighborUrl = settings.neighborUrl || '';
    renderStatic();
    renderNeighbor();
    renderCategoryFilter();
    await loadReminders();
    if (state.view === 'date') await loadDateView();
    else if (state.view === 'patient') await loadPatientView();
    else if (state.view === 'summary') await loadSummary();
    else if (state.view === 'report') await loadMonthEvents();
    else if (state.view === 'cal') await loadCalendar();
    else if (state.view === 'manage') {
      renderSlots();
      const f = $('#unit-form');
      if (!f.contains(document.activeElement)) {
        f.unitName.value = state.unitName;
        f.neighborName.value = state.neighborName;
        f.neighborUrl.value = state.neighborUrl;
      }
    }
    else await loadTrash();
  } catch (e) {
    toast(e.message);
  }
}

function showView(view) {
  state.view = view;
  $$('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.view === view));
  $$('.view').forEach((v) => (v.hidden = v.id !== 'view-' + view));
  refresh();
}

// 他のパソコンで書かれた記録を自動で反映（入力中は更新しない）
async function poll() {
  if (document.hidden || document.querySelector('dialog[open]')) return;
  try {
    const v = await api('version');
    if (v.version !== state.version) refresh();
  } catch {}
}

// ---------- イベント ----------

$$('.tab').forEach((tab) => tab.addEventListener('click', () => showView(tab.dataset.view)));
$('#btn-new').addEventListener('click', () => openNoteForm(null));

// 言語の切りかえ（この端末にだけ保存される）
$('#btn-lang').addEventListener('click', () => {
  $('#lang-list').innerHTML = I18N.LANGS.map((l) => {
    const on = l.code === I18N.lang;
    return `<button type="button" class="btn lang-opt ${on ? 'active' : ''}" data-lang="${l.code}" lang="${l.code}">${esc(l.name)}${on ? ' ✓' : ''}</button>`;
  }).join('');
  $('#lang-dialog').showModal();
});
$('#lang-list').addEventListener('click', (e) => {
  const b = e.target.closest('[data-lang]');
  if (!b) return;
  I18N.setLang(b.dataset.lang);
  $('#lang-dialog').close();
  renderStatic();
  refresh();
});
$('#lang-close').addEventListener('click', () => $('#lang-dialog').close());

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
$('#date-category').addEventListener('change', () => loadDateView().catch((e) => toast(e.message)));
$('#date-important').addEventListener('change', () => loadDateView().catch((e) => toast(e.message)));
$('#sum-patient').addEventListener('change', () => loadSummary().catch((e) => toast(e.message)));

$('#patient-search').addEventListener('input', renderPatientButtons);
$('#patient-buttons').addEventListener('click', (e) => {
  const b = e.target.closest('[data-pid]');
  if (b) selectPatient(b.dataset.pid);
});

// 予定（カレンダー）
document.addEventListener('click', async (e) => {
  const closest = (sel) => e.target.closest(sel);
  let b;
  try {
    if ((b = closest('[data-cal]'))) {
      const d = Number(b.dataset.cal);
      if (d === 0) {
        state.calMonth = thisMonth();
        state.calDay = ymd(new Date());
      } else state.calMonth = shiftMonth(state.calMonth, d);
      await loadCalendar();
    } else if ((b = closest('[data-day]'))) {
      state.calDay = b.dataset.day;
      if (b.dataset.day.slice(0, 7) !== state.calMonth) state.calMonth = b.dataset.day.slice(0, 7);
      await loadCalendar();
    } else if ((b = closest('[data-eadd]'))) openEventForm(null, b.dataset.eadd);
    else if ((b = closest('[data-eedit]'))) openEventForm(await api('events/' + b.dataset.eedit));
    else if ((b = closest('[data-erestore]'))) {
      await api(`events/${b.dataset.erestore}/restore`, { method: 'POST' });
      toast(t('toast.restored'));
      refresh();
    } else if ((b = closest('[data-epurge]'))) {
      if (!(await askConfirm(t('event.confirmPurge')))) return;
      await api(`events/${b.dataset.epurge}/purge`, { method: 'DELETE' });
      toast(t('toast.purged'));
      refresh();
    }
  } catch (err) {
    toast(err.message);
  }
});
$('#event-form').addEventListener('submit', saveEvent);
$('#eform-cancel').addEventListener('click', () => $('#event-dialog').close());
$('#event-form').addEventListener('click', (e) => {
  const p = e.target.closest('[data-epid]');
  const r = e.target.closest('[data-erep]');
  if (p) state.eventForm.patientId = p.dataset.epid || null;
  else if (r) state.eventForm.repeat = r.dataset.erep;
  else return;
  renderEventChoices();
});
$('#eform-delete').addEventListener('click', async () => {
  const id = $('#event-form').id.value;
  if (!(await askConfirm(t(state.eventForm.repeat ? 'event.confirmTrashRepeat' : 'event.confirmTrash')))) return;
  try {
    await api('events/' + id, { method: 'DELETE' });
    $('#event-dialog').close();
    toast(t('toast.trashed'));
    refresh();
  } catch (err) {
    toast(err.message);
  }
});

// 月間評価・月間まとめ：月の切りかえと「すべて見る」
document.addEventListener('click', (e) => {
  const m = e.target.closest('[data-month]');
  const all = e.target.closest('[data-mall]');
  if (m) {
    const month = shiftMonth(state.month, Number(m.dataset.month));
    if (month > thisMonth()) return;
    state.month = month;
    state.openMonthAll.clear();
    refresh();
  } else if (all) {
    const id = all.dataset.mall;
    if (!state.openMonthAll.delete(id)) state.openMonthAll.add(id);
    loadMonthEvents().catch((err) => toast(err.message));
  }
});

// 印刷：「もっと見る」で隠れている記録もすべて読み込んでから印刷する
async function printView() {
  if (state.view === 'summary') {
    $('#print-title').textContent = summaryTitle();
  } else if (state.view === 'report') {
    $('#print-title').textContent = t('title.report', { month: fmtMonth(state.month) });
  } else {
    $('#print-title').textContent = currentQuery().title;
    const list = state.lists[state.view];
    if (list && document.querySelector(`#view-${state.view} [data-more]`)) {
      list.count = 100000;
      await (state.view === 'date' ? loadDateView() : loadPatientView());
    }
  }
  window.print();
}

// 印刷
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-print]')) printView().catch((err) => toast(err.message));
});

// 記録の「直す」「消す」・ゴミ箱・写真の拡大
document.addEventListener('click', async (e) => {
  const closest = (sel) => e.target.closest(sel);
  const run = async (fn, msg) => {
    try {
      await fn();
      if (msg) toast(msg);
      refresh();
    } catch (err) {
      toast(err.message);
    }
  };
  let b;
  if ((b = closest('[data-edit]'))) {
    try { openNoteForm(await api('notes/' + b.dataset.edit)); } catch (err) { toast(err.message); }
  } else if ((b = closest('[data-del]'))) {
    if (await askConfirm(t('note.confirmTrash'))) run(() => api('notes/' + b.dataset.del, { method: 'DELETE' }), t('toast.trashed'));
  } else if ((b = closest('[data-nrestore]'))) {
    run(() => api(`notes/${b.dataset.nrestore}/restore`, { method: 'POST' }), t('toast.restored'));
  } else if ((b = closest('[data-npurge]'))) {
    if (await askConfirm(t('note.confirmPurge'))) run(() => api(`notes/${b.dataset.npurge}/purge`, { method: 'DELETE' }), t('toast.purged'));
  } else if ((b = closest('[data-prestore]'))) {
    run(() => api(`patients/${b.dataset.prestore}/restore`, { method: 'POST' }), t('toast.restored'));
  } else if ((b = closest('[data-ppurge]'))) {
    if (await askConfirm(t('patient.confirmPurge'))) {
      run(() => api(`patients/${b.dataset.ppurge}/purge`, { method: 'DELETE' }), t('toast.purged'));
    }
  } else if ((b = closest('[data-tview]'))) {
    state.openTrash = state.openTrash === b.dataset.tview ? null : b.dataset.tview;
    loadTrash().catch((err) => toast(err.message));
  } else if ((b = closest('[data-more]'))) {
    state.lists[b.dataset.more].count += PAGE;
    (b.dataset.more === 'date' ? loadDateView() : loadPatientView()).catch((err) => toast(err.message));
  } else if ((b = closest('.media-item')) && !closest('[data-remove]')) {
    const el = document.createElement(b.dataset.type === 'video' ? 'video' : 'img');
    el.src = b.dataset.src;
    if (b.dataset.type === 'video') Object.assign(el, { controls: true, autoplay: true, playsInline: true });
    $('#viewer-body').replaceChildren(el);
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
$('#note-form').category.addEventListener('input', renderFormChoices);
$('#note-form').addEventListener('click', (e) => {
  const p = e.target.closest('[data-fpid]');
  const c = e.target.closest('[data-fcat]');
  const r = e.target.closest('[data-remove]');
  if (p) state.form.patientId = p.dataset.fpid || null;
  else if (c) $('#note-form').category.value = catLabel(c.dataset.fcat);
  else if (r) {
    e.preventDefault();
    e.stopPropagation();
    state.form.media.splice(Number(r.dataset.remove), 1);
  } else return;
  renderFormChoices();
});

// 利用者の管理
// アドレスをまちがえていないか、ためしに開く
$('#neighbor-test').addEventListener('click', () => {
  let url = $('#unit-form').neighborUrl.value.trim();
  if (!url) return toast(t('toast.needUrl'));
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) url = 'http://' + url;
  if (!/^https?:\/\//i.test(url)) return toast(t('err.urlInvalid'));
  window.open(withLang(url), '_blank', 'noopener');
});
$('#unit-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const f = e.target;
    const saved = await api('settings', { method: 'PUT', body: { unitName: f.unitName.value, neighborName: f.neighborName.value, neighborUrl: f.neighborUrl.value } });
    // 保存された形（http:// を補ったもの）を入力欄にも反映する
    f.unitName.value = saved.unitName;
    f.neighborName.value = saved.neighborName;
    f.neighborUrl.value = saved.neighborUrl;
    toast(t('toast.saved'));
    refresh();
  } catch (err) {
    toast(err.message);
  }
});
$('#slot-list').addEventListener('click', async (e) => {
  const add = e.target.closest('[data-padd]');
  const edit = e.target.closest('[data-pedit]');
  const del = e.target.closest('[data-pdel]');
  if (add) openPatientForm(null, Number(add.dataset.padd));
  else if (edit) openPatientForm(state.patients.find((x) => x.id === edit.dataset.pedit));
  else if (del) {
    const p = state.patients.find((x) => x.id === del.dataset.pdel);
    if (!(await askConfirm(t('patient.confirmDelete', { name: t('patient.person', { name: p.name }) })))) return;
    api('patients/' + p.id, { method: 'DELETE' })
      .then(() => {
        if (state.selectedPatient === p.id) state.selectedPatient = null;
        toast(t('toast.patientTrashed'));
        refresh();
      })
      .catch((err) => toast(err.message));
  }
});
$('#patient-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const body = { name: f.name.value, kana: f.kana.value, room: f.room.value, memo: f.memo.value, slot: Number(f.slot.value) };
  try {
    if (f.id.value) await api('patients/' + f.id.value, { method: 'PUT', body });
    else await api('patients', { method: 'POST', body });
    $('#patient-dialog').close();
    toast(t('toast.saved'));
    refresh();
  } catch (err) {
    const el = $('#pform-error');
    el.textContent = err.message;
    el.hidden = false;
  }
});
$('#pform-cancel').addEventListener('click', () => $('#patient-dialog').close());

// 他の端末からの接続先を表示
api('info')
  .then((info) => {
    state.slots = info.slots;
    state.trashDays = info.trashDays;
    state.addresses = info.addresses || [];
    state.port = info.port;
    renderStatic();
    if (state.view === 'manage') renderSlots();
  })
  .catch(() => {});

I18N.init();
renderStatic();
refresh();
setInterval(poll, 10000);
