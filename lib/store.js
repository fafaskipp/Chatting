// 介護日記 — データの処理（サーバーとデモ版の両方で使う）
// 利用者・記録・月間評価・ゴミ箱の読み書きは、すべてここで行う。

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KaigoStore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULT_CATEGORIES = ['食事', '水分', '排泄', '入浴', '服薬・薬', '体調', '睡眠', 'ヒヤリ・事故', 'レク・活動', '家族連絡', 'その他'];
  // 月間評価で数える「ヒヤリ・事故」の記録（種類は自由入力なので、ことばで判定する）
  const INCIDENT_RE = /ヒヤリ|事故|転倒|転落|ケガ|けが|怪我|誤薬|誤嚥/;
  // 月間評価の項目
  const REPORT_AREAS = ['health', 'meal', 'excretion', 'sleep', 'adl', 'mood'];
  const TRENDS = ['up', 'same', 'down'];

  function localDate(d = new Date()) {
    const z = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
  }

  function prevMonth(month) {
    const [y, m] = month.split('-').map(Number);
    return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  }

  function fail(status, message) {
    return Object.assign(new Error(message), { status });
  }

  function str(v, max = 200) {
    return typeof v === 'string' ? v.trim().slice(0, max) : '';
  }

  const isIncident = (n) => INCIDENT_RE.test(n.category);

  function sortNotes(notes) {
    // 新しい日付・時刻が上（降順）
    return notes.sort((a, b) =>
      (b.date + (b.time || '99:99') + b.createdAt).localeCompare(a.date + (a.time || '99:99') + a.createdAt)
    );
  }

  function csvCell(v) {
    const s = String(v ?? '');
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  // opts: { db, slotCount, trashDays, newId, mediaExists(file), removeMedia(file), onChange() }
  function createStore(opts) {
    const SLOT_COUNT = opts.slotCount || 10;
    const TRASH_DAYS = opts.trashDays || 30;
    const newId = opts.newId || (() => Math.random().toString(16).slice(2, 10) + Date.now().toString(16).slice(-6));
    const mediaExists = opts.mediaExists || (() => true);
    const removeMedia = opts.removeMedia || (() => {});
    const db = opts.db;
    const now = () => new Date().toISOString();

    // ---------- 以前の版のデータをそろえる ----------
    db.patients = db.patients || [];
    db.notes = db.notes || [];
    db.reports = db.reports || [];
    for (const n of db.notes) if (n.category === '事故・ケガ') n.category = 'ヒヤリ・事故';
    for (const p of db.patients) if (!p.slot && !p.deletedAt) p.slot = firstFreeSlot();

    function commit() {
      db.version = (db.version || 0) + 1;
      if (opts.onChange) opts.onChange(db);
    }

    // ---------- 利用者 ----------

    function activePatients() {
      return db.patients.filter((p) => !p.deletedAt);
    }

    function activePatient(id) {
      return db.patients.find((p) => p.id === id && !p.deletedAt);
    }

    function firstFreeSlot() {
      const used = new Set(activePatients().map((p) => p.slot));
      for (let i = 1; i <= SLOT_COUNT; i++) if (!used.has(i)) return i;
      return null;
    }

    function slotOwner(slot) {
      return db.patients.find((p) => !p.deletedAt && p.slot === slot);
    }

    function cleanPatient(body) {
      const name = str(body.name, 50);
      if (!name) throw fail(400, '名前を入力してください');
      return { name, kana: str(body.kana, 50), room: str(body.room, 20), memo: str(body.memo, 1000) };
    }

    // ---------- 記録 ----------

    function cleanNote(body) {
      const date = str(body.date, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw fail(400, '日付が正しくありません');
      const time = str(body.time, 5);
      const patientId = str(body.patientId, 32) || null;
      if (patientId && !activePatient(patientId)) throw fail(400, '利用者が見つかりません');
      const media = (Array.isArray(body.media) ? body.media : [])
        .map((m) => ({ file: str(m && m.file, 100).replace(/[\\/]/g, ''), type: m && m.type === 'video' ? 'video' : 'image' }))
        .filter((m) => m.file && mediaExists(m.file));
      const text = str(body.text, 20000);
      if (!text && media.length === 0) throw fail(400, '内容か写真・動画を入れてください');
      return {
        date,
        time: /^\d{2}:\d{2}$/.test(time) ? time : '',
        patientId,
        category: str(body.category, 30) || 'その他',
        important: Boolean(body.important),
        author: str(body.author, 30),
        text,
        media,
      };
    }

    function filterNotes(q) {
      const patientId = q.get('patientId');
      const from = q.get('from');
      const to = q.get('to');
      const category = q.get('category');
      const keyword = (q.get('q') || '').trim().toLowerCase();
      const importantOnly = q.get('important') === '1';
      const inTrash = q.get('trash') === '1'; // ゴミ箱の利用者の記録を見るとき
      return sortNotes(
        db.notes.filter((n) => {
          if (inTrash ? !n.deletedWithPatient : n.deletedAt) return false;
          if (patientId === 'none' ? n.patientId : patientId && n.patientId !== patientId) return false;
          if (from && n.date < from) return false;
          if (to && n.date > to) return false;
          if (category && n.category !== category) return false;
          if (importantOnly && !n.important) return false;
          if (keyword && !`${n.text} ${n.author} ${n.category}`.toLowerCase().includes(keyword)) return false;
          return true;
        })
      );
    }

    function removeUnusedMedia(files) {
      const used = new Set(db.notes.flatMap((n) => n.media.map((m) => m.file)));
      for (const f of files) if (!used.has(f)) removeMedia(f);
    }

    // ---------- 月間評価 ----------

    function cleanReport(body) {
      const items = {};
      for (const key of REPORT_AREAS) {
        const it = (body.items && body.items[key]) || {};
        items[key] = { trend: TRENDS.includes(it.trend) ? it.trend : '', text: str(it.text, 2000) };
      }
      return {
        items,
        incidentReview: str(body.incidentReview, 5000),
        incidentPlan: str(body.incidentPlan, 5000),
        summary: str(body.summary, 5000),
        author: str(body.author, 30),
      };
    }

    function monthNotes(patientId, month) {
      return sortNotes(db.notes.filter((n) => !n.deletedAt && n.patientId === patientId && n.date.startsWith(month)));
    }

    function findReport(patientId, month) {
      return db.reports.find((r) => !r.deletedAt && r.patientId === patientId && r.month === month) || null;
    }

    // その月の利用者ごとの状況（評価を書いたか、ヒヤリ・事故は何件か）
    function reportOverview(month) {
      return activePatients()
        .sort((a, b) => a.slot - b.slot)
        .map((p) => {
          const notes = monthNotes(p.id, month);
          const r = findReport(p.id, month);
          return {
            patient: p,
            reportId: r ? r.id : null,
            noteCount: notes.length,
            incidentCount: notes.filter(isIncident).length,
          };
        });
    }

    // 評価を書く・見るときに必要なもの：その月の記録から拾ったヒヤリ・事故と重要な記録、先月の評価
    function reportContext(patientId, month) {
      const notes = monthNotes(patientId, month);
      return {
        report: findReport(patientId, month),
        prev: findReport(patientId, prevMonth(month)),
        noteCount: notes.length,
        incidents: notes.filter(isIncident),
        important: notes.filter((n) => n.important && !isIncident(n)),
      };
    }

    function reportList(q) {
      const patientId = q.get('patientId');
      const slots = new Map(db.patients.map((p) => [p.id, p.slot || 99]));
      return db.reports
        .filter((r) => !r.deletedAt && (!patientId || r.patientId === patientId))
        .map((r) => ({ ...r, incidentCount: monthNotes(r.patientId, r.month).filter(isIncident).length }))
        .sort((a, b) => b.month.localeCompare(a.month) || slots.get(a.patientId) - slots.get(b.patientId));
    }

    // ---------- ゴミ箱 ----------

    function expiry(deletedAt) {
      return new Date(new Date(deletedAt).getTime() + TRASH_DAYS * 86400000).toISOString();
    }

    function trashList() {
      const patients = db.patients
        .filter((p) => p.deletedAt)
        .map((p) => ({
          ...p,
          noteCount: db.notes.filter((n) => n.deletedWithPatient === p.id).length,
          reportCount: db.reports.filter((r) => r.deletedWithPatient === p.id).length,
          expiresAt: expiry(p.deletedAt),
        }))
        .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
      const notes = db.notes
        .filter((n) => n.deletedAt && !n.deletedWithPatient)
        .map((n) => ({ ...n, expiresAt: expiry(n.deletedAt) }))
        .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
      const reports = db.reports
        .filter((r) => r.deletedAt && !r.deletedWithPatient)
        .map((r) => ({ ...r, expiresAt: expiry(r.deletedAt) }))
        .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
      return { patients, notes, reports };
    }

    function purgeNotes(notes) {
      const ids = new Set(notes.map((n) => n.id));
      db.notes = db.notes.filter((n) => !ids.has(n.id));
      removeUnusedMedia(notes.flatMap((n) => n.media.map((m) => m.file)));
    }

    function purgeReports(reports) {
      const ids = new Set(reports.map((r) => r.id));
      db.reports = db.reports.filter((r) => !ids.has(r.id));
    }

    function purgePatient(p) {
      purgeNotes(db.notes.filter((n) => n.deletedWithPatient === p.id));
      purgeReports(db.reports.filter((r) => r.deletedWithPatient === p.id));
      db.patients = db.patients.filter((x) => x.id !== p.id);
    }

    function purgeExpiredTrash() {
      const limit = new Date(Date.now() - TRASH_DAYS * 86400000).toISOString();
      const t = trashList();
      const old = (list) => list.filter((x) => x.deletedAt < limit);
      const [ps, ns, rs] = [old(t.patients), old(t.notes), old(t.reports)];
      if (!ps.length && !ns.length && !rs.length) return;
      ps.forEach(purgePatient);
      purgeNotes(ns);
      purgeReports(rs);
      commit();
    }

    // ---------- 年間まとめ・Excel ----------

    function yearSummary(q) {
      const live = db.notes.filter((n) => !n.deletedAt);
      const years = [...new Set(live.map((n) => n.date.slice(0, 4)))].sort().reverse();
      const year = /^\d{4}$/.test(q.get('year') || '') ? q.get('year') : String(new Date().getFullYear());
      const patientId = q.get('patientId') || '';
      const notes = live.filter(
        (n) => n.date.startsWith(year) && (!patientId || (patientId === 'none' ? !n.patientId : n.patientId === patientId))
      );
      const months = Array(12).fill(0);
      const categories = new Map();
      const patients = new Map();
      for (const n of notes) {
        months[Number(n.date.slice(5, 7)) - 1]++;
        categories.set(n.category, (categories.get(n.category) || 0) + 1);
        const key = n.patientId || 'none';
        patients.set(key, (patients.get(key) || 0) + 1);
      }
      const names = new Map(db.patients.map((p) => [p.id, p.name]));
      return {
        year,
        years: years.includes(year) ? years : [year, ...years].sort().reverse(),
        total: notes.length,
        months,
        categories: [...categories].sort((a, b) => b[1] - a[1]),
        patients: [...patients]
          .map(([id, count]) => ({ id, name: id === 'none' ? '全体・共有' : names.get(id) || '', count }))
          .sort((a, b) => b.count - a.count),
        important: sortNotes(notes.filter((n) => n.important)),
      };
    }

    function csv(q) {
      const names = new Map(db.patients.map((p) => [p.id, p.name]));
      const rows = [['日付', '時刻', '利用者', '種類', '重要', '内容', '記入者', '写真・動画']];
      for (const n of filterNotes(q)) {
        rows.push([
          n.date,
          n.time,
          n.patientId ? names.get(n.patientId) || '' : '全体・共有',
          n.category,
          n.important ? '★' : '',
          n.text,
          n.author,
          n.media.length ? `${n.media.length}件` : '',
        ]);
      }
      // Excel で文字化けしないよう BOM 付き UTF-8
      return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
    }

    // ---------- API の振り分け ----------
    // パスは /api/<resource>/<id>/<action>。戻り値はそのまま JSON で返す。エラーは fail() を投げる。

    function handle(method, pathname, q, body) {
      const [, resource, id, action] = pathname.split('/').filter(Boolean);

      if (resource === 'version' && method === 'GET') return { version: db.version || 0 };

      if (resource === 'categories' && method === 'GET') {
        const used = db.notes.filter((n) => !n.deletedAt).map((n) => n.category);
        return [...new Set([...DEFAULT_CATEGORIES, ...used])].filter(Boolean);
      }

      if (resource === 'summary' && method === 'GET') return yearSummary(q);

      if (resource === 'trash' && method === 'GET') return trashList();

      if (resource === 'patients') {
        if (method === 'GET' && !id) return activePatients().sort((a, b) => a.slot - b.slot);
        if (method === 'POST' && !id) {
          const slot = Number(body.slot) || firstFreeSlot();
          if (!slot || slot < 1 || slot > SLOT_COUNT) throw fail(400, '空いている枠がありません。先にだれかを削除してください');
          if (slotOwner(slot)) throw fail(400, `No.${slot} の枠はもう使われています`);
          const p = { id: newId(), slot, ...cleanPatient(body), createdAt: now() };
          db.patients.push(p);
          commit();
          return p;
        }
        const p = db.patients.find((x) => x.id === id);
        if (!p) throw fail(404, '利用者が見つかりません');
        if (method === 'PUT' && !action && !p.deletedAt) {
          Object.assign(p, cleanPatient(body), { updatedAt: now() });
          commit();
          return p;
        }
        // 削除 → 記録・月間評価といっしょにゴミ箱へ。枠は空きになる
        if (method === 'DELETE' && !action && !p.deletedAt) {
          p.deletedAt = now();
          p.formerSlot = p.slot;
          p.slot = null;
          for (const x of [...db.notes, ...db.reports]) {
            if (x.patientId === p.id && !x.deletedAt) {
              x.deletedAt = p.deletedAt;
              x.deletedWithPatient = p.id;
            }
          }
          commit();
          return { ok: true };
        }
        if (method === 'POST' && action === 'restore' && p.deletedAt) {
          const slot = p.formerSlot && !slotOwner(p.formerSlot) ? p.formerSlot : firstFreeSlot();
          if (!slot) throw fail(400, '空いている枠がないため戻せません。先にだれかを削除してください');
          p.slot = slot;
          delete p.deletedAt;
          delete p.formerSlot;
          for (const x of [...db.notes, ...db.reports]) {
            if (x.deletedWithPatient === p.id) {
              delete x.deletedAt;
              delete x.deletedWithPatient;
            }
          }
          commit();
          return p;
        }
        if (method === 'DELETE' && action === 'purge' && p.deletedAt) {
          purgePatient(p);
          commit();
          return { ok: true };
        }
      }

      if (resource === 'notes') {
        if (method === 'GET' && !id) {
          const all = filterNotes(q);
          const limit = Number(q.get('limit'));
          if (!limit) return all;
          const offset = Number(q.get('offset')) || 0;
          return { notes: all.slice(offset, offset + limit), total: all.length };
        }
        if (method === 'POST' && !id) {
          const n = { id: newId(), ...cleanNote(body), createdAt: now(), updatedAt: now() };
          db.notes.push(n);
          commit();
          return n;
        }
        const n = db.notes.find((x) => x.id === id);
        if (!n) throw fail(404, '記録が見つかりません');
        if (method === 'GET' && !action) return n;
        if (method === 'PUT' && !action && !n.deletedAt) {
          const before = n.media.map((m) => m.file);
          Object.assign(n, cleanNote(body), { updatedAt: now() });
          removeUnusedMedia(before);
          commit();
          return n;
        }
        if (method === 'DELETE' && !action && !n.deletedAt) {
          n.deletedAt = now();
          commit();
          return { ok: true };
        }
        if (method === 'POST' && action === 'restore' && n.deletedAt && !n.deletedWithPatient) {
          const owner = n.patientId && db.patients.find((x) => x.id === n.patientId);
          if (owner && owner.deletedAt) throw fail(400, `先に ${owner.name} 様をゴミ箱から戻してください`);
          if (n.patientId && !owner) throw fail(400, 'この記録の利用者はもういません');
          delete n.deletedAt;
          commit();
          return n;
        }
        if (method === 'DELETE' && action === 'purge' && n.deletedAt && !n.deletedWithPatient) {
          purgeNotes([n]);
          commit();
          return { ok: true };
        }
      }

      if (resource === 'reports') {
        if (method === 'GET' && id === 'overview') {
          const month = str(q.get('month'), 7);
          if (!/^\d{4}-\d{2}$/.test(month)) throw fail(400, '月が正しくありません');
          return reportOverview(month);
        }
        if (method === 'GET' && id === 'context') {
          const month = str(q.get('month'), 7);
          const patientId = str(q.get('patientId'), 32);
          if (!/^\d{4}-\d{2}$/.test(month) || !activePatient(patientId)) throw fail(400, '月か利用者が正しくありません');
          return reportContext(patientId, month);
        }
        if (method === 'GET' && !id) return reportList(q);
        if (method === 'POST' && !id) {
          const month = str(body.month, 7);
          const patientId = str(body.patientId, 32);
          if (!/^\d{4}-\d{2}$/.test(month)) throw fail(400, '月が正しくありません');
          if (!activePatient(patientId)) throw fail(400, '利用者が見つかりません');
          if (findReport(patientId, month)) throw fail(400, 'この月の評価はもう作られています。一覧から開いて直してください');
          const r = { id: newId(), month, patientId, ...cleanReport(body), createdAt: now(), updatedAt: now() };
          db.reports.push(r);
          commit();
          return r;
        }
        const r = db.reports.find((x) => x.id === id);
        if (!r) throw fail(404, '評価が見つかりません');
        if (method === 'GET' && !action) return r;
        if (method === 'PUT' && !action && !r.deletedAt) {
          Object.assign(r, cleanReport(body), { updatedAt: now() });
          commit();
          return r;
        }
        if (method === 'DELETE' && !action && !r.deletedAt) {
          r.deletedAt = now();
          commit();
          return { ok: true };
        }
        if (method === 'POST' && action === 'restore' && r.deletedAt && !r.deletedWithPatient) {
          const owner = db.patients.find((x) => x.id === r.patientId);
          if (owner && owner.deletedAt) throw fail(400, `先に ${owner.name} 様をゴミ箱から戻してください`);
          if (!owner) throw fail(400, 'この評価の利用者はもういません');
          if (findReport(r.patientId, r.month)) throw fail(400, 'この月の評価がもう別にあるため戻せません');
          delete r.deletedAt;
          commit();
          return r;
        }
        if (method === 'DELETE' && action === 'purge' && r.deletedAt && !r.deletedWithPatient) {
          purgeReports([r]);
          commit();
          return { ok: true };
        }
      }

      throw fail(404, '見つかりません');
    }

    return { db, handle, csv, purgeExpiredTrash };
  }

  return { createStore, localDate, fail, DEFAULT_CATEGORIES };
});
