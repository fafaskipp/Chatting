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
  openTrash: null,
  reportMonth: ymd(new Date()).slice(0, 7),
  reportOpen: null, // 開いている月間評価 { patientId, month }
  reportCtx: null,
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
    today: [daysAgo(0), '', '今日'],
    yesterday: [daysAgo(1), daysAgo(1), '昨日'],
    week: [daysAgo(6), '', 'この1週間'],
    month: [daysAgo(30), '', 'この1か月'],
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
    box.innerHTML = '<div class="empty">利用者がまだ登録されていません。「⚙️ 利用者の管理」から登録してください。</div>';
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

// ---------- 月間評価 ----------

const AREAS = [
  ['health', '体調', '熱・血圧・病気・痛み'],
  ['meal', '食事・水分', '食べる量・飲む量・むせ'],
  ['excretion', '排泄', 'トイレ・便秘・失禁'],
  ['sleep', '睡眠', '夜の様子・昼寝'],
  ['adl', '動き・生活動作', '歩く・立つ・着替え・入浴'],
  ['mood', '気持ち・表情', '笑顔・不安・物忘れ'],
];
const TREND_LABEL = { up: '◎ 良くなった', same: '○ 変わらない', down: '△ 悪くなった' };
const TREND_MARK = { up: '◎', same: '○', down: '△' };

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

function trendHtml(t) {
  return t ? `<span class="trend trend-${t}">${TREND_LABEL[t]}</span>` : '<span class="trend trend-none">－</span>';
}

function incidentChip(count) {
  return count
    ? `<span class="chip chip-inc">⚠️ ヒヤリ・事故 ${count}件</span>`
    : '<span class="chip chip-zero">ヒヤリ・事故 0件</span>';
}

function miniNoteHtml(n) {
  return `<div class="mini-note" style="border-color:${catColor(n.category)}">
    <span class="when">${esc(jpDate(n.date, false))} ${esc(n.time)}</span>
    <span class="tag" style="background:${catColor(n.category)}">${esc(n.category)}</span>
    ${n.text ? `<div class="text">${esc(n.text)}</div>` : ''}
  </div>`;
}

async function loadReports() {
  if (state.reportOpen) return loadReportDetail();
  $('#rep-main').hidden = false;
  $('#rep-detail').hidden = true;
  $('#rep-month-label').textContent = jpMonth(state.reportMonth);
  $('#rep-next').disabled = state.reportMonth >= thisMonth();

  const sel = $('#rep-filter');
  const cur = sel.value;
  sel.innerHTML =
    '<option value="">全員</option>' +
    state.patients.map((p) => `<option value="${p.id}" ${p.id === cur ? 'selected' : ''}>${esc(p.name)} 様</option>`).join('');

  const [overview, history] = await Promise.all([
    api('reports/overview?month=' + state.reportMonth),
    api('reports?patientId=' + encodeURIComponent(sel.value)),
  ]);

  $('#rep-overview').innerHTML = overview.length
    ? overview
        .map(
          (o) => `<div class="slot ${o.reportId ? '' : 'empty-slot'}">
            <div class="name">${esc(o.patient.name)} 様</div>
            <div class="chips">
              ${o.reportId ? '<span class="chip chip-done">✅ 評価済み</span>' : '<span class="chip chip-todo">まだ書いていません</span>'}
              ${incidentChip(o.incidentCount)}
              <span class="chip chip-zero">記録 ${o.noteCount}件</span>
            </div>
            <div class="actions">
              ${o.reportId
                ? `<button class="btn btn-edit" data-ropen="${o.patient.id}">📖 見る・直す</button>`
                : `<button class="btn btn-add" data-rwrite="${o.patient.id}">📝 評価を書く</button>`}
            </div>
          </div>`
        )
        .join('')
    : '<div class="empty">利用者がまだ登録されていません。「⚙️ 利用者の管理」から登録してください。</div>';

  $('#rep-history').innerHTML = history.length
    ? history
        .map(
          (r) => `<div class="history-item">
            <div>
              <div class="name">${jpMonth(r.month)}　${esc(patientName(r.patientId))} 様</div>
              <div class="icons">${AREAS.map(([k, label]) => {
                const t = r.items[k] && r.items[k].trend;
                return `<span class="trend ${t ? 'trend-' + t : 'trend-none'}">${label.split('・')[0]} ${t ? TREND_MARK[t] : '－'}</span>`;
              }).join('')}</div>
            </div>
            <div class="chips">${incidentChip(r.incidentCount)}</div>
            <button class="btn btn-edit" data-rhist="${r.patientId}|${r.month}">📖 開く</button>
          </div>`
        )
        .join('')
    : '<div class="empty">まだ評価はありません。</div>';
}

function openReport(patientId, month) {
  state.reportOpen = { patientId, month };
  return loadReportDetail();
}

async function loadReportDetail() {
  const { patientId, month } = state.reportOpen;
  const p = state.patients.find((x) => x.id === patientId);
  if (!p) {
    state.reportOpen = null;
    return loadReports();
  }
  const ctx = await api(`reports/context?patientId=${encodeURIComponent(patientId)}&month=${month}`);
  state.reportCtx = ctx;
  const r = ctx.report;
  $('#rep-main').hidden = true;
  const el = $('#rep-detail');
  el.hidden = false;

  let html = `<div class="toolbar no-print" style="justify-content:space-between">
      <button class="btn btn-gray" data-rback>← 一覧に戻る</button>
      <span class="actions">
        ${r ? '<button class="btn btn-edit" data-redit>✏️ 直す</button>' : '<button class="btn btn-add" data-redit>📝 評価を書く</button>'}
        ${r ? '<button class="btn btn-print" data-print>🖨 印刷・PDF</button>' : ''}
        ${r ? '<button class="btn btn-del" data-rdel>🗑 消す</button>' : ''}
      </span>
    </div>
    <div class="month-nav no-print" style="margin-bottom:12px">
      <button class="btn btn-gray" data-rshift="-1">◀ 前の月</button>
      <span></span>
      <button class="btn btn-gray" data-rshift="1" ${month >= thisMonth() ? 'disabled' : ''}>次の月 ▶</button>
    </div>
    <h2>📝 ${jpMonth(month)}　${esc(p.name)} 様の月間評価</h2>`;

  if (r) {
    html += `<p class="sub-hint">記入：${esc(r.author) || '－'}　／　最後に直した日：${jpDateTime(r.updatedAt)}</p>
      <div class="table-wrap"><table class="rep-table">
        <thead><tr><th>項目</th><th>今月</th><th>先月</th><th>メモ</th></tr></thead>
        <tbody>${AREAS.map(([k, label]) => {
          const it = r.items[k] || {};
          const prev = ctx.prev && ctx.prev.items[k] ? ctx.prev.items[k].trend : '';
          return `<tr><th>${label}</th><td>${trendHtml(it.trend)}</td><td>${trendHtml(prev)}</td><td class="memo">${esc(it.text) || ''}</td></tr>`;
        }).join('')}</tbody>
      </table></div>`;
  } else {
    html += `<div class="empty" style="margin-bottom:16px">この月の評価はまだありません。<br>「📝 評価を書く」から書けます。</div>`;
  }

  html += `<div class="rep-block ${ctx.incidents.length ? 'danger' : ''}">
      <h3>⚠️ ヒヤリ・事故（${ctx.incidents.length}件）</h3>
      ${ctx.incidents.length ? ctx.incidents.map(miniNoteHtml).join('') : '<p class="sub-hint">この月の記録にヒヤリ・事故はありません。</p>'}
      ${r && r.incidentReview ? `<h3 style="margin-top:12px">ふり返り</h3><div class="text">${esc(r.incidentReview)}</div>` : ''}
      ${r && r.incidentPlan ? `<h3 style="margin-top:12px">これからの対策</h3><div class="text">${esc(r.incidentPlan)}</div>` : ''}
    </div>`;
  if (ctx.important.length) {
    html += `<div class="rep-block"><h3>⭐ この月の重要な記録（${ctx.important.length}件）</h3>${ctx.important.map(miniNoteHtml).join('')}</div>`;
  }
  if (r && r.summary) {
    html += `<div class="rep-block"><h3>まとめ・来月の目標</h3><div class="text">${esc(r.summary)}</div></div>`;
  }
  html += `<p class="sub-hint">この月の記録：${ctx.noteCount}件</p>`;
  el.innerHTML = html;
}

function openReportForm() {
  const { patientId, month } = state.reportOpen;
  const ctx = state.reportCtx;
  const r = ctx.report;
  const f = $('#report-form');
  f.reset();
  $('#rform-error').hidden = true;
  $('#rform-title').textContent = `${jpMonth(month)}　${patientName(patientId)} 様の月間評価`;
  f.incidentReview.value = r ? r.incidentReview : '';
  f.incidentPlan.value = r ? r.incidentPlan : '';
  f.summary.value = r ? r.summary : '';
  f.author.value = r ? r.author : localStorage.getItem('author') || '';
  $('#rform-areas').innerHTML = AREAS.map(([k, label, hint]) => {
    const it = (r && r.items[k]) || {};
    const prev = ctx.prev && ctx.prev.items[k] ? ctx.prev.items[k].trend : '';
    return `<div class="area" data-area="${k}">
      <div class="area-head"><b>${label}</b><span class="area-prev">先月：${prev ? TREND_LABEL[prev] : 'なし'}</span></div>
      <small class="muted">${hint}</small>
      <div class="trend-btns">${['up', 'same', 'down']
        .map((t) => `<button type="button" class="trend-btn ${it.trend === t ? 'active' : ''}" data-t="${t}">${TREND_LABEL[t]}</button>`)
        .join('')}</div>
      <textarea rows="2" placeholder="メモ（例：${hint.split('・')[0]}について気づいたこと）">${esc(it.text || '')}</textarea>
    </div>`;
  }).join('');
  $('#rform-incidents').innerHTML = ctx.incidents.length
    ? `<p class="sub-hint">日々の記録から見つけたヒヤリ・事故（${ctx.incidents.length}件）：</p>${ctx.incidents.map(miniNoteHtml).join('')}`
    : '<p class="sub-hint">この月の記録にヒヤリ・事故はありません。</p>';
  $('#report-dialog').showModal();
}

async function saveReport(e) {
  e.preventDefault();
  const f = $('#report-form');
  const { patientId, month } = state.reportOpen;
  const items = {};
  for (const area of $$('#rform-areas .area')) {
    const active = area.querySelector('.trend-btn.active');
    items[area.dataset.area] = { trend: active ? active.dataset.t : '', text: area.querySelector('textarea').value };
  }
  const body = {
    month,
    patientId,
    items,
    incidentReview: f.incidentReview.value,
    incidentPlan: f.incidentPlan.value,
    summary: f.summary.value,
    author: f.author.value,
  };
  localStorage.setItem('author', body.author);
  try {
    const r = state.reportCtx.report;
    if (r) await api('reports/' + r.id, { method: 'PUT', body });
    else await api('reports', { method: 'POST', body });
    $('#report-dialog').close();
    toast('保存しました ✅');
    refresh();
  } catch (err) {
    const el = $('#rform-error');
    el.textContent = err.message;
    el.hidden = false;
  }
}

// ---------- 年間まとめ ----------

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
  return `年間まとめ ${$('#sum-year').value}年（${sel.options[sel.selectedIndex]?.text || '全員'}）`;
}

async function loadSummary() {
  const yearSel = $('#sum-year');
  const patSel = $('#sum-patient');
  const curPatient = patSel.value;
  patSel.innerHTML =
    '<option value="">全員</option>' +
    state.patients.map((p) => `<option value="${p.id}" ${p.id === curPatient ? 'selected' : ''}>${esc(p.name)} 様</option>`).join('') +
    `<option value="none" ${curPatient === 'none' ? 'selected' : ''}>全体・共有</option>`;
  const s = await api(`summary?year=${encodeURIComponent(yearSel.value)}&patientId=${encodeURIComponent(patSel.value)}`);
  yearSel.innerHTML = s.years.map((y) => `<option ${y === s.year ? 'selected' : ''}>${y}</option>`).join('');
  const busiest = s.months.indexOf(Math.max(...s.months));
  let html = `<div class="stats">
      <div class="stat"><div class="num">${s.total}</div><div class="lab">記録の合計</div></div>
      <div class="stat"><div class="num">${s.important.length}</div><div class="lab">⭐ 重要な記録</div></div>
      <div class="stat"><div class="num">${s.categories[0] ? esc(s.categories[0][0]) : '－'}</div><div class="lab">いちばん多い種類</div></div>
      <div class="stat"><div class="num">${s.total ? busiest + 1 + '月' : '－'}</div><div class="lab">記録がいちばん多い月</div></div>
    </div>`;
  if (!s.total) {
    $('#sum-body').innerHTML = html + '<div class="empty">この年の記録はありません。</div>';
    return;
  }
  html += barsHtml('月ごとの記録', s.months.map((n, i) => [`${i + 1}月`, n]));
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
  if (!t.patients.length && !t.notes.length && !t.reports.length) {
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
            <div class="sub">削除した日：${jpDateTime(p.deletedAt)}　／　記録 ${p.noteCount} 件${p.reportCount ? `・月間評価 ${p.reportCount} 件` : ''}</div>
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
  if (t.reports.length) {
    html += '<h2>消した月間評価</h2>';
    for (const r of t.reports) {
      const name = trashedNames.get(r.patientId) || patientName(r.patientId);
      html += `<div class="trash-item"><div class="row-head">
          <div><div class="name">${jpMonth(r.month)}　${esc(name)} 様の月間評価</div>
            <div class="sub">消した日：${jpDateTime(r.deletedAt)}　／　${daysLeft(r.expiresAt)}</div></div>
          <div class="actions">
            <button class="btn btn-restore" data-rrestore="${r.id}">↩️ 元に戻す</button>
            <button class="btn btn-del" data-rpurge="${r.id}">完全に消す</button>
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
    f.author.value = localStorage.getItem('author') || '';
    const pid = state.view === 'patient' && state.selectedPatient !== 'none' ? state.selectedPatient : null;
    state.form = { patientId: pid, media: [] };
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
  state.uploading++;
  save.disabled = true;
  prog.hidden = false;
  try {
    for (const file of files) {
      try {
        state.form.media.push(await uploadFile(await shrinkImage(file)));
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
    [state.patients, state.categories] = await Promise.all([api('patients'), api('categories')]);
    renderCategoryFilter();
    if (state.view === 'date') await loadDateView();
    else if (state.view === 'patient') await loadPatientView();
    else if (state.view === 'summary') await loadSummary();
    else if (state.view === 'report') await loadReports();
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
$('#sum-year').addEventListener('change', () => loadSummary().catch((e) => toast(e.message)));
$('#sum-patient').addEventListener('change', () => loadSummary().catch((e) => toast(e.message)));

$('#patient-search').addEventListener('input', renderPatientButtons);
$('#patient-buttons').addEventListener('click', (e) => {
  const b = e.target.closest('[data-pid]');
  if (b) selectPatient(b.dataset.pid);
});

// 月間評価
$('#rep-prev').addEventListener('click', () => {
  state.reportMonth = shiftMonth(state.reportMonth, -1);
  loadReports().catch((e) => toast(e.message));
});
$('#rep-next').addEventListener('click', () => {
  state.reportMonth = shiftMonth(state.reportMonth, 1);
  loadReports().catch((e) => toast(e.message));
});
$('#rep-filter').addEventListener('change', () => loadReports().catch((e) => toast(e.message)));
document.addEventListener('click', async (e) => {
  const t = (sel) => e.target.closest(sel);
  let b;
  try {
    if ((b = t('[data-ropen]'))) await openReport(b.dataset.ropen, state.reportMonth);
    else if ((b = t('[data-rwrite]'))) {
      await openReport(b.dataset.rwrite, state.reportMonth);
      openReportForm();
    } else if ((b = t('[data-rhist]'))) {
      const [pid, month] = b.dataset.rhist.split('|');
      state.reportMonth = month;
      await openReport(pid, month);
      window.scrollTo(0, 0);
    } else if (t('[data-rback]')) {
      state.reportOpen = null;
      await loadReports();
    } else if (t('[data-redit]')) openReportForm();
    else if ((b = t('[data-rshift]'))) {
      const month = shiftMonth(state.reportOpen.month, Number(b.dataset.rshift));
      if (month > thisMonth()) return;
      state.reportMonth = month;
      await openReport(state.reportOpen.patientId, month);
    } else if (t('[data-rdel]')) {
      if (!(await askConfirm('この月間評価をゴミ箱に移しますか？\n（ゴミ箱から元に戻せます）'))) return;
      await api('reports/' + state.reportCtx.report.id, { method: 'DELETE' });
      state.reportOpen = null;
      toast('ゴミ箱に移しました');
      refresh();
    } else if ((b = t('[data-rrestore]'))) {
      await api(`reports/${b.dataset.rrestore}/restore`, { method: 'POST' });
      toast('元に戻しました ✅');
      refresh();
    } else if ((b = t('[data-rpurge]'))) {
      if (!(await askConfirm('この月間評価を完全に消しますか？\n二度と元に戻せません。'))) return;
      await api(`reports/${b.dataset.rpurge}/purge`, { method: 'DELETE' });
      toast('完全に消しました');
      refresh();
    }
  } catch (err) {
    toast(err.message);
  }
});
$('#report-form').addEventListener('submit', saveReport);
$('#rform-cancel').addEventListener('click', () => $('#report-dialog').close());
// もう一度押すと選択を外せる
$('#rform-areas').addEventListener('click', (e) => {
  const btn = e.target.closest('.trend-btn');
  if (!btn) return;
  const was = btn.classList.contains('active');
  btn.parentElement.querySelectorAll('.trend-btn').forEach((x) => x.classList.remove('active'));
  if (!was) btn.classList.add('active');
});

// 印刷：「もっと見る」で隠れている記録もすべて読み込んでから印刷する
async function printView() {
  if (state.view === 'summary') {
    $('#print-title').textContent = summaryTitle();
  } else if (state.view === 'report') {
    $('#print-title').textContent = '';
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
    if (await askConfirm('この方の情報と記録をすべて完全に消しますか？\n二度と元に戻せません。')) {
      run(() => api(`patients/${b.dataset.ppurge}/purge`, { method: 'DELETE' }), '完全に消しました');
    }
  } else if ((b = t('[data-tview]'))) {
    state.openTrash = state.openTrash === b.dataset.tview ? null : b.dataset.tview;
    loadTrash().catch((err) => toast(err.message));
  } else if ((b = t('[data-more]'))) {
    state.lists[b.dataset.more].count += PAGE;
    (b.dataset.more === 'date' ? loadDateView() : loadPatientView()).catch((err) => toast(err.message));
  } else if ((b = t('.media-item')) && !t('[data-remove]')) {
    const src = b.dataset.src;
    $('#viewer-body').innerHTML = b.dataset.type === 'video'
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
    if (!(await askConfirm(`${p.name} 様を削除しますか？\n\n・この枠は「空き」になり、新しい方を登録できます\n・記録はゴミ箱に移り、あとから元に戻せます`))) return;
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
