// 介護日記 — 画面の動き
'use strict';

// よく使う種類の色（それ以外は自動で色を決める）
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
const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
const PAGE = 50; // 1回に表示する記録の数
const PHOTO_MAX_PX = 1600; // 写真はこの大きさまで縮小して保存

const state = {
  view: 'date',
  range: 'today',
  pickedDate: '',
  selectedPatient: null,
  patients: [],
  categories: Object.keys(CATEGORY_COLORS),
  slots: 10,
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

// ブラウザが保存を許可していないとき（Safari のプライベートなど）でも止まらないように
function remember(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key) || '';
    localStorage.setItem(key, value);
  } catch {}
  return '';
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

function jpDate(s, withLabel = true) {
  const [y, m, d] = s.split('-').map(Number);
  const w = WEEK[new Date(y, m - 1, d).getDay()];
  const label = !withLabel ? '' : s === daysAgo(0) ? '（今日）' : s === daysAgo(1) ? '（昨日）' : '';
  return `${y}年${m}月${d}日（${w}）${label}`;
}

function jpDateTime(iso) {
  const d = new Date(iso);
  return `${jpDate(ymd(d), false)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 2500);
}

function catColor(name) {
  if (CATEGORY_COLORS[name]) return CATEGORY_COLORS[name];
  let h = 0;
  for (const ch of String(name)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return AUTO_COLORS[h % AUTO_COLORS.length];
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
      <button type="button" class="media-item" data-src="/uploads/${esc(m.file)}" data-type="${m.type}" title="大きく見る">
        ${m.type === 'video'
          ? `<video src="/uploads/${esc(m.file)}#t=0.1" preload="metadata" muted></video><span class="play">▶</span>`
          : `<img src="/uploads/${esc(m.file)}" loading="lazy" alt="">`}
        ${removable ? `<span class="remove" data-remove="${i}" role="button" aria-label="消す">✕</span>` : ''}
      </button>`
    )
    .join('');
}

// mode: 'normal'（直す・消す）, 'readonly'（ボタンなし）, 'trash'（元に戻す・完全に消す）
function noteHtml(n, showPatient, mode = 'normal', nameOverride) {
  const name = nameOverride || patientName(n.patientId);
  const patient = n.patientId
    ? `<span class="tag tag-patient">👤 ${esc(name)} 様</span>`
    : `<span class="tag tag-none">全体・共有</span>`;
  const buttons =
    mode === 'normal'
      ? `<button class="btn btn-edit" data-edit="${n.id}">✏️ 直す</button>
         <button class="btn btn-del" data-del="${n.id}">🗑 消す</button>`
      : mode === 'trash'
        ? `<button class="btn btn-restore" data-nrestore="${n.id}">↩️ 元に戻す</button>
           <button class="btn btn-del" data-npurge="${n.id}">完全に消す</button>`
        : '';
  return `
    <article class="note ${n.important ? 'important' : ''}">
      <div class="note-head">
        ${n.important ? '<span class="tag" style="background:#f9a825;color:#000">⭐ 重要</span>' : ''}
        ${mode === 'trash' ? `<span class="note-time">${esc(jpDate(n.date, false))}</span>` : ''}
        <span class="note-time">${n.time ? '🕒 ' + esc(n.time) : ''}</span>
        ${showPatient ? patient : ''}
        <span class="tag" style="background:${catColor(n.category)}">${esc(n.category)}</span>
      </div>
      ${n.text ? `<div class="note-text">${esc(n.text)}</div>` : ''}
      ${n.media.length ? `<div class="media-grid">${mediaHtml(n.media, false)}</div>` : ''}
      <div class="note-foot">
        <span>${n.author ? '記入：' + esc(n.author) : ''}</span>
        <span class="actions">${buttons}</span>
      </div>
    </article>`;
}

function notesHtml(notes, showPatient, mode, nameOverride) {
  if (!notes.length) return '<div class="empty">記録はありません。</div>';
  let html = '';
  let lastDate = '';
  for (const n of notes) {
    if (n.date !== lastDate) {
      html += `<h3 class="day-head">${jpDate(n.date)}</h3>`;
      lastDate = n.date;
    }
    html += noteHtml(n, showPatient, mode, nameOverride);
  }
  return html;
}

// 今の画面の検索条件（表示・印刷・Excel 共通）
function currentQuery() {
  const q = new URLSearchParams();
  let title = '';
  if (state.view === 'patient') {
    if (state.selectedPatient) q.set('patientId', state.selectedPatient);
    title = state.selectedPatient === 'none' ? '全体・共有の記録' : `${patientName(state.selectedPatient)} 様の記録`;
    return { q, title };
  }
  const range = {
    today: [daysAgo(0), daysAgo(0), '今日'],
    yesterday: [daysAgo(1), daysAgo(1), '昨日'],
    week: [daysAgo(6), daysAgo(0), 'この1週間'],
    month: [daysAgo(30), daysAgo(0), 'この1か月'],
    all: ['', '', 'すべて'],
  }[state.range];
  let [from, to, label] = range;
  if (state.pickedDate) {
    from = to = state.pickedDate;
    label = jpDate(state.pickedDate, false);
  }
  if (from) q.set('from', from);
  if (to) q.set('to', to);
  const cat = $('#date-category').value;
  if (cat) q.set('category', cat);
  const kw = $('#date-search').value.trim();
  if (kw) q.set('q', kw);
  if ($('#date-important').checked) q.set('important', '1');
  title = `介護日記（${label}${cat ? '・' + cat : ''}${kw ? '・「' + kw + '」' : ''}${$('#date-important').checked ? '・重要のみ' : ''}）`;
  return { q, title };
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
      (rest > 0 ? `<button class="btn more-btn" data-more="${name}">⬇ もっと見る（あと ${rest} 件）</button>` : '')
    : emptyHtml;
}

async function loadDateView() {
  const { q } = currentQuery();
  const active = state.pickedDate || $('#date-category').value || $('#date-search').value.trim();
  $('#date-more summary').textContent = active ? '🔍 詳しく探す（条件あり）' : '🔍 詳しく探す';
  await loadPaged('date', $('#date-list'), q, true, '<div class="empty">記録はまだありません。<br>「＋ 記録を書く」から書けます。</div>');
}

function renderCategoryFilter() {
  const sel = $('#date-category');
  const cur = sel.value;
  sel.innerHTML =
    '<option value="">すべての種類</option>' + state.categories.map((c) => `<option ${c === cur ? 'selected' : ''}>${esc(c)}</option>`).join('');
}

function renderPatientButtons() {
  const kw = $('#patient-search').value.replace(/\s/g, '').toLowerCase();
  const list = state.patients.filter((p) => !kw || `${p.name}${p.kana}`.replace(/\s/g, '').toLowerCase().includes(kw));
  const box = $('#patient-buttons');
  if (!state.patients.length) {
    box.innerHTML = '<div class="empty">利用者がまだ登録されていません。「⚙️ 管理」から登録してください。</div>';
    return;
  }
  box.innerHTML =
    list
      .map(
        (p) => `<button class="pbtn ${state.selectedPatient === p.id ? 'active' : ''}" data-pid="${p.id}">
          ${esc(p.name)}<small>${esc(p.kana)}${p.room ? '　' + esc(p.room) + '号室' : ''}</small></button>`
      )
      .join('') +
    (kw ? '' : `<button class="pbtn ${state.selectedPatient === 'none' ? 'active' : ''}" data-pid="none">全体・共有<small>利用者なしの記録</small></button>`);
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
    listEl.innerHTML = '<div class="empty">上の名前のボタンを押すと、その人の記録だけが表示されます。</div>';
    return;
  }
  const p = state.patients.find((x) => x.id === state.selectedPatient);
  head.innerHTML = p
    ? `<h2>👤 ${esc(p.name)} 様の記録</h2>${p.memo ? `<div class="patient-memo">📌 ${esc(p.memo)}</div>` : ''}`
    : '<h2>全体・共有の記録</h2>';
  const q = new URLSearchParams({ patientId: state.selectedPatient });
  await loadPaged('patient', listEl, q, false, '<div class="empty">記録はありません。</div>');
}

function selectPatient(id) {
  state.selectedPatient = id;
  loadPatientView().catch((e) => toast(e.message));
}

// ---------- 予定（カレンダー） ----------

const REPEAT_LABEL = { '': 'なし', weekly: '毎週', monthly: '毎月' };

function eventColor(e) {
  return e.patientId ? 'var(--green)' : 'var(--blue)';
}

function eventHtml(e, withDate) {
  const who = e.patientId
    ? `<span class="tag tag-patient">👤 ${esc(patientName(e.patientId))} 様</span>`
    : '<span class="tag" style="background:var(--blue)">全体</span>';
  return `<div class="event-item">
    <div class="ev-time">${withDate ? esc(Number(e.date.slice(8, 10)) + '日') + '<br>' : ''}${e.time ? esc(e.time) : '終日'}</div>
    <div class="ev-body">
      <div class="title">${esc(e.title)}</div>
      <div class="chips">${who}${e.repeat ? `<span class="tag tag-none">🔁 ${REPEAT_LABEL[e.repeat]}</span>` : ''}</div>
      ${e.memo ? `<div class="text">${esc(e.memo)}</div>` : ''}
    </div>
    <button class="btn btn-edit" data-eedit="${e.id}">✏️ 直す</button>
  </div>`;
}

async function loadCalendar() {
  const [y, m] = state.calMonth.split('-').map(Number);
  $('#cal-label').textContent = jpMonth(state.calMonth);
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
    WEEK.map((w, i) => `<div class="cal-head ${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}">${w}</div>`).join('') +
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
          ${list.length > 3 ? `<span class="cal-more">＋${list.length - 3}件</span>` : ''}
        </button>`;
      })
      .join('');

  const dayList = byDay.get(state.calDay) || [];
  $('#cal-day').innerHTML = state.calDay
    ? `<div class="rep-block">
        <div class="area-head"><h3>${jpDate(state.calDay)}の予定</h3>
          <button class="btn btn-add" style="width:auto" data-eadd="${state.calDay}">＋ この日に入れる</button></div>
        ${dayList.length ? dayList.map((e) => eventHtml(e, false)).join('') : '<p class="sub-hint">この日の予定はありません。</p>'}
      </div>`
    : '';

  const monthList = events.filter((e) => e.date.slice(0, 7) === state.calMonth);
  $('#cal-list').innerHTML = monthList.length
    ? `<div class="rep-block">${monthList.map((e) => eventHtml(e, true)).join('')}</div>`
    : '<div class="empty">この月の予定はまだありません。<br>「＋ 予定を入れる」から入れられます。</div>';
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
    `<div>・${e.time ? esc(e.time) + '　' : ''}<b>${esc(e.title)}</b>${e.patientId ? `（${esc(patientName(e.patientId))} 様）` : ''}</div>`;
  $('#reminder').innerHTML = list.length
    ? `<div class="reminder">
        ${todays.length ? `<h3>🔔 今日の予定（${todays.length}件）</h3>${todays.map(line).join('')}` : ''}
        ${tomorrows.length ? `<h3 style="margin-top:8px">📅 明日の予定（${tomorrows.length}件）</h3>${tomorrows.map(line).join('')}` : ''}
      </div>`
    : '';
}

function renderEventChoices() {
  $('#eform-patients').innerHTML =
    state.patients
      .map((p) => `<button type="button" class="choice ${state.eventForm.patientId === p.id ? 'active' : ''}" data-epid="${p.id}">${esc(p.name)}<small>${esc(p.kana)}</small></button>`)
      .join('') +
    `<button type="button" class="choice ${!state.eventForm.patientId ? 'active' : ''}" data-epid="">全体<small>特定の人ではない</small></button>`;
  $('#eform-repeat').innerHTML = Object.entries(REPEAT_LABEL)
    .map(([k, label]) => {
      const on = state.eventForm.repeat === k;
      return `<button type="button" class="cat-chip ${on ? 'active' : ''}" data-erep="${k}" style="color:var(--blue);${on ? 'background:var(--blue)' : ''}">${label}</button>`;
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
  $('#eform-title').textContent = e ? '予定を直す' : '予定を入れる';
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
    toast('保存しました ✅');
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

function jpMonth(m) {
  const [y, mm] = m.split('-').map(Number);
  return `${y}年${mm}月`;
}

function shiftMonth(m, d) {
  const [y, mm] = m.split('-').map(Number);
  return ymd(new Date(y, mm - 1 + d, 1)).slice(0, 7);
}

function renderMonthNav() {
  $$('.month-label').forEach((el) => (el.textContent = jpMonth(state.month)));
  $$('[data-month="1"]').forEach((b) => (b.disabled = state.month >= thisMonth()));
}

function countChip(icon, label, n, cls) {
  return `<span class="chip ${n ? cls : 'chip-zero'}">${n ? icon + ' ' : ''}${label} ${n}件</span>`;
}

function miniNoteHtml(n) {
  return `<div class="mini-note" style="border-color:${catColor(n.category)}">
    <span class="when">${esc(jpDate(n.date, false))} ${esc(n.time)}</span>
    <span class="tag" style="background:${catColor(n.category)}">${esc(n.category)}</span>
    ${n.text ? `<div class="text">${esc(n.text)}</div>` : ''}
  </div>`;
}

// 月間評価：利用者ごとに、その月に起きたこと（ヒヤリ・事故と重要な記録）を見るだけ
async function loadMonthEvents() {
  renderMonthNav();
  const s = await api('summary?month=' + state.month);
  const groups = s.groups.filter((g) => g.id !== 'none' || g.notes.length);
  if (!groups.length) {
    $('#rep-body').innerHTML = '<div class="empty">利用者がまだ登録されていません。「⚙️ 管理」から登録してください。</div>';
    return;
  }
  $('#rep-body').innerHTML = groups
    .map((g) => {
      const open = state.openMonthAll.has(g.id);
      return `<div class="rep-block ${g.incidents.length ? 'danger' : ''}">
        <div class="area-head">
          <h3>${g.id === 'none' ? '📢 全体・共有' : '👤 ' + esc(g.name) + ' 様'}</h3>
          <div class="chips">
            ${countChip('⚠️', 'ヒヤリ・事故', g.incidents.length, 'chip-inc')}
            ${countChip('⭐', '重要', g.important.length, 'chip-imp')}
            <span class="chip chip-zero">記録 ${g.notes.length}件</span>
          </div>
        </div>
        ${g.incidents.length ? `<h4>⚠️ ヒヤリ・事故</h4>${g.incidents.map(miniNoteHtml).join('')}` : ''}
        ${g.important.length ? `<h4>⭐ 重要な記録</h4>${g.important.map(miniNoteHtml).join('')}` : ''}
        ${!g.incidents.length && !g.important.length
          ? `<p class="sub-hint">${g.notes.length ? 'ヒヤリ・事故や重要な記録はありませんでした。' : 'この月の記録はありません。'}</p>`
          : ''}
        ${g.notes.length
          ? `<button class="btn more-btn no-print" data-mall="${g.id}">${open ? '▲ 閉じる' : `📖 この月の記録をすべて見る（${g.notes.length}件）`}</button>`
          : ''}
        ${open ? `<h4 class="no-print">この月の記録（${g.notes.length}件）</h4><div class="no-print">${g.notes.map(miniNoteHtml).join('')}</div>` : ''}
      </div>`;
    })
    .join('');
}

function barsHtml(title, rows, colorOf) {
  if (!rows.length) return '';
  const max = Math.max(1, ...rows.map((r) => r[1]));
  return `<div class="bars"><h3>${title}</h3>${rows
    .map(
      ([label, n]) => `<div class="bar-row"><span class="bl" title="${esc(label)}">${esc(label)}</span>
        <span class="bt"><span class="bf" style="width:${(n / max) * 100}%;background:${colorOf ? colorOf(label) : 'var(--blue)'}"></span></span>
        <span class="bn">${n}件</span></div>`
    )
    .join('')}</div>`;
}

function summaryTitle() {
  const sel = $('#sum-patient');
  return `月間まとめ ${jpMonth(state.month)}（${sel.options[sel.selectedIndex]?.text || '全員'}）`;
}

// 月間まとめ：その月の件数（種類ごと・利用者ごと）と重要な記録
async function loadSummary() {
  renderMonthNav();
  const patSel = $('#sum-patient');
  const curPatient = patSel.value;
  patSel.innerHTML =
    '<option value="">全員</option>' +
    state.patients.map((p) => `<option value="${p.id}" ${p.id === curPatient ? 'selected' : ''}>${esc(p.name)} 様</option>`).join('') +
    `<option value="none" ${curPatient === 'none' ? 'selected' : ''}>全体・共有</option>`;
  const s = await api(`summary?month=${state.month}&patientId=${encodeURIComponent(patSel.value)}`);
  let html = `<div class="stats">
      <div class="stat"><div class="num">${s.total}</div><div class="lab">記録の合計</div></div>
      <div class="stat"><div class="num">${s.incidentCount}</div><div class="lab">⚠️ ヒヤリ・事故</div></div>
      <div class="stat"><div class="num">${s.importantCount}</div><div class="lab">⭐ 重要な記録</div></div>
      <div class="stat"><div class="num">${s.categories[0] ? esc(s.categories[0][0]) : '－'}</div><div class="lab">いちばん多い種類</div></div>
    </div>`;
  if (!s.total) {
    $('#sum-body').innerHTML = html + '<div class="empty">この月の記録はありません。</div>';
    return;
  }
  html += barsHtml('種類ごとの記録', s.categories, catColor);
  if (!patSel.value) html += barsHtml('利用者ごとの記録', s.patients.map((p) => [p.name, p.count]), () => 'var(--green)');
  html += `<h2>⭐ 重要な記録（${s.important.length}件）</h2>`;
  html += s.important.length ? notesHtml(s.important, !patSel.value, 'readonly') : '<div class="empty">重要な記録はありません。</div>';
  $('#sum-body').innerHTML = html;
}

// ---------- 利用者の管理（枠） ----------

function renderSlots() {
  $('#slot-count').textContent = state.slots;
  let html = '';
  for (let i = 1; i <= state.slots; i++) {
    const p = state.patients.find((x) => x.slot === i);
    html += p
      ? `<div class="slot">
          <div class="slot-no">No.${i}</div>
          <div class="name">${esc(p.name)} 様</div>
          <div class="sub">${esc(p.kana)}${p.room ? '　' + esc(p.room) + '号室' : ''}${p.memo ? '\n📌 ' + esc(p.memo) : ''}</div>
          <div class="actions">
            <button class="btn btn-edit" data-pedit="${p.id}">✏️ 編集</button>
            <button class="btn btn-del" data-pdel="${p.id}">🗑 削除</button>
          </div></div>`
      : `<div class="slot empty-slot">
          <div class="slot-no">No.${i}</div>
          <div class="slot-empty-label">（空き）</div>
          <button class="btn btn-add" data-padd="${i}">＋ ここに登録する</button>
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
  $('#pform-title').textContent = p ? `No.${p.slot}　${p.name} 様の情報を編集` : `No.${slot} に新しい利用者を登録`;
  $('#patient-dialog').showModal();
}

// ---------- ゴミ箱 ----------

function daysLeft(iso) {
  const d = Math.ceil((new Date(iso) - Date.now()) / 86400000);
  return d <= 1 ? '⏳ まもなく自動で消えます' : `⏳ あと ${d} 日で自動で消えます`;
}

async function loadTrash() {
  const t = await api('trash');
  const el = $('#trash-body');
  if (!t.patients.length && !t.notes.length && !t.events.length) {
    el.innerHTML = '<div class="empty">ゴミ箱は空です。</div>';
    return;
  }
  const trashedNames = new Map(t.patients.map((p) => [p.id, p.name]));
  let html = '';
  if (t.patients.length) {
    html += '<h2>削除した利用者</h2>';
    for (const p of t.patients) {
      const open = state.openTrash === p.id;
      html += `<div class="trash-item">
        <div class="row-head">
          <div><div class="name">${esc(p.name)} 様</div>
            <div class="sub">削除した日：${jpDateTime(p.deletedAt)}　／　記録 ${p.noteCount} 件${p.eventCount ? `・予定 ${p.eventCount} 件` : ''}</div>
            <div class="sub">${daysLeft(p.expiresAt)}</div></div>
          <div class="actions">
            ${p.noteCount ? `<button class="btn btn-edit" data-tview="${p.id}">${open ? '▲ 閉じる' : '📖 記録を見る'}</button>` : ''}
            <button class="btn btn-restore" data-prestore="${p.id}">↩️ 元に戻す</button>
            <button class="btn btn-del" data-ppurge="${p.id}">完全に消す</button>
          </div>
        </div>
        ${open ? `<div class="trash-notes" id="tnotes-${p.id}">読み込み中…</div>` : ''}
      </div>`;
    }
  }
  if (t.notes.length) {
    html += '<h2>消した記録</h2>';
    for (const n of t.notes) {
      const name = trashedNames.get(n.patientId) || patientName(n.patientId);
      html += `<div class="trash-item"><div class="sub">消した日：${jpDateTime(n.deletedAt)}　／　${daysLeft(n.expiresAt)}</div>${noteHtml(n, true, 'trash', name)}</div>`;
    }
  }
  if (t.events.length) {
    html += '<h2>消した予定</h2>';
    for (const e of t.events) {
      html += `<div class="trash-item"><div class="row-head">
          <div><div class="name">${esc(jpDate(e.date, false))}　${esc(e.title)}</div>
            <div class="sub">消した日：${jpDateTime(e.deletedAt)}　／　${daysLeft(e.expiresAt)}</div></div>
          <div class="actions">
            <button class="btn btn-restore" data-erestore="${e.id}">↩️ 元に戻す</button>
            <button class="btn btn-del" data-epurge="${e.id}">完全に消す</button>
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
    `<button type="button" class="choice ${!state.form.patientId ? 'active' : ''}" data-fpid="">全体・共有<small>特定の人ではない</small></button>`;
  const cur = $('#note-form').category.value.trim();
  $('#nform-categories').innerHTML = state.categories
    .map((c) => {
      const col = catColor(c);
      const on = c === cur;
      return `<button type="button" class="cat-chip ${on ? 'active' : ''}" data-fcat="${esc(c)}" style="color:${col};${on ? `background:${col}` : ''}">${esc(c)}</button>`;
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
    $('#nform-title').textContent = '記録を直す';
    f.id.value = note.id;
    f.date.value = note.date;
    f.time.value = note.time;
    f.category.value = note.category;
    f.text.value = note.text;
    f.author.value = note.author;
    f.important.checked = note.important;
    state.form = { patientId: note.patientId, media: [...note.media] };
  } else {
    $('#nform-title').textContent = '記録を書く';
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
    category: f.category.value,
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
    [state.patients, state.categories] = await Promise.all([api('patients'), api('categories')]);
    renderCategoryFilter();
    await loadReminders();
    if (state.view === 'date') await loadDateView();
    else if (state.view === 'patient') await loadPatientView();
    else if (state.view === 'summary') await loadSummary();
    else if (state.view === 'report') await loadMonthEvents();
    else if (state.view === 'cal') await loadCalendar();
    else if (state.view === 'manage') renderSlots();
    else await loadTrash();
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
  if (document.hidden || document.querySelector('dialog[open]')) return;
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
  const t = (sel) => e.target.closest(sel);
  let b;
  try {
    if ((b = t('[data-cal]'))) {
      const d = Number(b.dataset.cal);
      if (d === 0) {
        state.calMonth = thisMonth();
        state.calDay = ymd(new Date());
      } else state.calMonth = shiftMonth(state.calMonth, d);
      await loadCalendar();
    } else if ((b = t('[data-day]'))) {
      state.calDay = b.dataset.day;
      if (b.dataset.day.slice(0, 7) !== state.calMonth) state.calMonth = b.dataset.day.slice(0, 7);
      await loadCalendar();
    } else if ((b = t('[data-eadd]'))) openEventForm(null, b.dataset.eadd);
    else if ((b = t('[data-eedit]'))) openEventForm(await api('events/' + b.dataset.eedit));
    else if ((b = t('[data-erestore]'))) {
      await api(`events/${b.dataset.erestore}/restore`, { method: 'POST' });
      toast('元に戻しました ✅');
      refresh();
    } else if ((b = t('[data-epurge]'))) {
      if (!(await askConfirm('この予定を完全に消しますか？\n二度と元に戻せません。'))) return;
      await api(`events/${b.dataset.epurge}/purge`, { method: 'DELETE' });
      toast('完全に消しました');
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
  const msg = state.eventForm.repeat
    ? 'この予定をゴミ箱に移しますか？\n（くり返しの予定は、すべての回が消えます）'
    : 'この予定をゴミ箱に移しますか？\n（ゴミ箱から元に戻せます）';
  if (!(await askConfirm(msg))) return;
  try {
    await api('events/' + id, { method: 'DELETE' });
    $('#event-dialog').close();
    toast('ゴミ箱に移しました');
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
    $('#print-title').textContent = `月間評価 ${jpMonth(state.month)}`;
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

// 印刷・Excel
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-print]')) printView().catch((err) => toast(err.message));
  else if (e.target.closest('[data-export]')) {
    const a = document.createElement('a');
    a.href = '/api/export.csv?' + currentQuery().q;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
});

// 記録の「直す」「消す」・ゴミ箱・写真の拡大
document.addEventListener('click', async (e) => {
  const t = (sel) => e.target.closest(sel);
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
  if ((b = t('[data-edit]'))) {
    try { openNoteForm(await api('notes/' + b.dataset.edit)); } catch (err) { toast(err.message); }
  } else if ((b = t('[data-del]'))) {
    if (await askConfirm('この記録をゴミ箱に移しますか？\n（ゴミ箱から元に戻せます）')) run(() => api('notes/' + b.dataset.del, { method: 'DELETE' }), 'ゴミ箱に移しました');
  } else if ((b = t('[data-nrestore]'))) {
    run(() => api(`notes/${b.dataset.nrestore}/restore`, { method: 'POST' }), '元に戻しました ✅');
  } else if ((b = t('[data-npurge]'))) {
    if (await askConfirm('この記録を完全に消しますか？\n二度と元に戻せません。')) run(() => api(`notes/${b.dataset.npurge}/purge`, { method: 'DELETE' }), '完全に消しました');
  } else if ((b = t('[data-prestore]'))) {
    run(() => api(`patients/${b.dataset.prestore}/restore`, { method: 'POST' }), '元に戻しました ✅');
  } else if ((b = t('[data-ppurge]'))) {
    if (await askConfirm('この方の情報と、この方に関係する記録・予定をすべて完全に消しますか？\n二度と元に戻せません。')) {
      run(() => api(`patients/${b.dataset.ppurge}/purge`, { method: 'DELETE' }), '完全に消しました');
    }
  } else if ((b = t('[data-tview]'))) {
    state.openTrash = state.openTrash === b.dataset.tview ? null : b.dataset.tview;
    loadTrash().catch((err) => toast(err.message));
  } else if ((b = t('[data-more]'))) {
    state.lists[b.dataset.more].count += PAGE;
    (b.dataset.more === 'date' ? loadDateView() : loadPatientView()).catch((err) => toast(err.message));
  } else if ((b = t('.media-item')) && !t('[data-remove]')) {
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
  else if (c) $('#note-form').category.value = c.dataset.fcat;
  else if (r) {
    e.preventDefault();
    e.stopPropagation();
    state.form.media.splice(Number(r.dataset.remove), 1);
  } else return;
  renderFormChoices();
});

// 利用者の管理
$('#slot-list').addEventListener('click', async (e) => {
  const add = e.target.closest('[data-padd]');
  const edit = e.target.closest('[data-pedit]');
  const del = e.target.closest('[data-pdel]');
  if (add) openPatientForm(null, Number(add.dataset.padd));
  else if (edit) openPatientForm(state.patients.find((x) => x.id === edit.dataset.pedit));
  else if (del) {
    const p = state.patients.find((x) => x.id === del.dataset.pdel);
    if (!(await askConfirm(`${p.name} 様を削除しますか？\n\n・この枠は「空き」になり、新しい方を登録できます\n・この方の記録と予定はすべてゴミ箱に移り、あとから元に戻せます`))) return;
    api('patients/' + p.id, { method: 'DELETE' })
      .then(() => {
        if (state.selectedPatient === p.id) state.selectedPatient = null;
        toast('削除しました（ゴミ箱に移しました）');
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
    toast('保存しました ✅');
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
    $('#trash-days').textContent = info.trashDays;
    if (state.view === 'manage') renderSlots();
    const urls = info.addresses.map((ip) => `<code>http://${ip}:${info.port}</code>`).join('<br>');
    $('#server-info').innerHTML = `💻 ほかのパソコン・タブレットからは、同じネットワークにつないで次のアドレスを開いてください：<br>${urls || '（ネットワークが見つかりません）'}`;
  })
  .catch(() => {});

refresh();
setInterval(poll, 10000);
