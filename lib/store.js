// 介護日記 — データの処理（サーバーとデモ版の両方で使う）
// 設定・利用者・記録・予定・月ごとのまとめ・ゴミ箱の読み書きは、すべてここで行う。

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KaigoStore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULT_CATEGORIES = ['食事', '水分', '排泄', '入浴', '服薬・薬', '体調', '睡眠', 'ヒヤリ・事故', 'レク・活動', '家族連絡', 'その他'];
  // 「ヒヤリ・事故」として数える記録（種類は自由入力なので、ことばで判定する）
  const INCIDENT_RE = /ヒヤリ|事故|転倒|転落|ケガ|けが|怪我|誤薬|誤嚥/;

  function localDate(d = new Date()) {
    const z = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
  }

  function fail(status, message) {
    return Object.assign(new Error(message), { status });
  }

  function str(v, max = 200) {
    return typeof v === 'string' ? v.trim().slice(0, max) : '';
  }

  const isIncident = (n) => INCIDENT_RE.test(n.category);
  const REPEATS = ['', 'weekly', 'monthly'];
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  // 形だけでなく、2月31日のような存在しない日付もはじく
  const isDate = (s) => DATE_RE.test(s) && fmtDate(parseDate(s)) === s;

  // 日付の計算は UTC で行い、タイムゾーンのずれを避ける
  function parseDate(s) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }
  function fmtDate(d) {
    return d.toISOString().slice(0, 10);
  }

  function sortNotes(notes) {
    // 新しい日付・時刻が上（降順）
    return notes.sort((a, b) =>
      (b.date + (b.time || '99:99') + b.createdAt).localeCompare(a.date + (a.time || '99:99') + a.createdAt)
    );
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
    db.events = db.events || [];
    db.settings = db.settings || { unitName: '' };
    for (const n of db.notes) if (n.category === '事故・ケガ') n.category = 'ヒヤリ・事故';
    for (const p of db.patients) if (!p.slot && !p.deletedAt) p.slot = firstFreeSlot();
    // ゴミ箱の利用者の分は、先に1件ずつ消したものもその人にまとめる
    for (const x of [...db.notes, ...db.events]) {
      const owner = x.patientId && db.patients.find((p) => p.id === x.patientId);
      if (owner && owner.deletedAt && x.deletedAt && !x.deletedWithPatient) {
        x.deletedWithPatient = owner.id;
        x.deletedBefore = true;
      }
    }

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
      if (!isDate(date)) throw fail(400, '日付が正しくありません');
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

    // ---------- 予定（カレンダー） ----------

    function cleanEvent(body) {
      const date = str(body.date, 10);
      if (!isDate(date)) throw fail(400, '日付が正しくありません');
      const title = str(body.title, 100);
      if (!title) throw fail(400, '予定の内容を入力してください');
      const time = str(body.time, 5);
      const patientId = str(body.patientId, 32) || null;
      if (patientId && !activePatient(patientId)) throw fail(400, '利用者が見つかりません');
      const repeat = REPEATS.includes(body.repeat) ? body.repeat : '';
      const until = repeat && isDate(str(body.until, 10)) ? str(body.until, 10) : '';
      if (until && until < date) throw fail(400, '「いつまで」は始まりの日より後にしてください');
      return { date, time: /^\d{2}:\d{2}$/.test(time) ? time : '', title, patientId, repeat, until, memo: str(body.memo, 2000) };
    }

    // from〜to の間の予定を、くり返しも1回ずつに広げて返す
    function eventsBetween(from, to) {
      const out = [];
      const push = (e, date) => {
        if (date >= from && date <= to && date >= e.date && (!e.until || date <= e.until)) out.push({ ...e, date, baseDate: e.date });
      };
      for (const e of db.events) {
        if (e.deletedAt) continue;
        if (!e.repeat) push(e, e.date);
        else if (e.repeat === 'weekly') {
          const start = parseDate(e.date);
          const first = Math.max(0, Math.ceil((parseDate(from) - start) / (7 * 86400000)));
          for (let i = first; ; i++) {
            const d = fmtDate(new Date(start.getTime() + i * 7 * 86400000));
            if (d > to) break;
            push(e, d);
          }
        } else {
          // 毎月同じ日（31日などがない月はとばす）
          const day = Number(e.date.slice(8, 10));
          let [y, m] = from.split('-').map(Number);
          for (;;) {
            const d = new Date(Date.UTC(y, m - 1, day));
            if (fmtDate(d).slice(0, 7) > to.slice(0, 7)) break;
            if (d.getUTCDate() === day) push(e, fmtDate(d));
            m === 12 ? ((y += 1), (m = 1)) : (m += 1);
          }
        }
      }
      return out.sort((a, b) => (a.date + (a.time || '00:00')).localeCompare(b.date + (b.time || '00:00')));
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
          eventCount: db.events.filter((e) => e.deletedWithPatient === p.id).length,
          expiresAt: expiry(p.deletedAt),
        }))
        .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
      const notes = db.notes
        .filter((n) => n.deletedAt && !n.deletedWithPatient)
        .map((n) => ({ ...n, expiresAt: expiry(n.deletedAt) }))
        .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
      const events = db.events
        .filter((e) => e.deletedAt && !e.deletedWithPatient)
        .map((e) => ({ ...e, expiresAt: expiry(e.deletedAt) }))
        .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
      return { patients, notes, events };
    }

    function purgeNotes(notes) {
      const ids = new Set(notes.map((n) => n.id));
      db.notes = db.notes.filter((n) => !ids.has(n.id));
      removeUnusedMedia(notes.flatMap((n) => n.media.map((m) => m.file)));
    }

    function purgeEvents(events) {
      const ids = new Set(events.map((e) => e.id));
      db.events = db.events.filter((e) => !ids.has(e.id));
    }

    // 利用者を完全に消すときは、その人に関係する記録・予定もすべて消す
    function purgePatient(p) {
      purgeNotes(db.notes.filter((n) => n.deletedWithPatient === p.id || n.patientId === p.id));
      purgeEvents(db.events.filter((e) => e.deletedWithPatient === p.id || e.patientId === p.id));
      db.patients = db.patients.filter((x) => x.id !== p.id);
    }

    function purgeExpiredTrash() {
      const limit = new Date(Date.now() - TRASH_DAYS * 86400000).toISOString();
      const t = trashList();
      const old = (list) => list.filter((x) => x.deletedAt < limit);
      const [ps, ns, es] = [old(t.patients), old(t.notes), old(t.events)];
      if (!ps.length && !ns.length && !es.length) return;
      ps.forEach(purgePatient);
      purgeNotes(ns);
      purgeEvents(es);
      commit();
    }

    // ---------- 月間まとめ ----------

    // 月ごとのまとめ：その月の件数と、利用者ごとに起きたこと（ヒヤリ・事故・重要な記録）
    function monthSummary(q) {
      const month = /^\d{4}-\d{2}$/.test(q.get('month') || '') ? q.get('month') : localDate().slice(0, 7);
      const patientId = q.get('patientId') || '';
      const all = sortNotes(db.notes.filter((n) => !n.deletedAt && n.date.startsWith(month)));
      const notes = all.filter((n) => !patientId || (patientId === 'none' ? !n.patientId : n.patientId === patientId));
      const categories = new Map();
      for (const n of notes) categories.set(n.category, (categories.get(n.category) || 0) + 1);
      const group = (id, name) => {
        const list = all.filter((n) => (id === 'none' ? !n.patientId : n.patientId === id));
        return { id, name, notes: list, incidents: list.filter(isIncident), important: list.filter((n) => n.important && !isIncident(n)) };
      };
      const groups = activePatients()
        .sort((a, b) => a.slot - b.slot)
        .map((p) => group(p.id, p.name));
      groups.push(group('none', '全体・共有'));
      return {
        month,
        total: notes.length,
        importantCount: notes.filter((n) => n.important).length,
        incidentCount: notes.filter(isIncident).length,
        categories: [...categories].sort((a, b) => b[1] - a[1]),
        patients: groups.map((g) => ({ id: g.id, name: g.name, count: g.notes.length })).filter((g) => g.count),
        important: notes.filter((n) => n.important),
        groups,
      };
    }

    // ---------- API の振り分け ----------
    // パスは /api/<resource>/<id>/<action>。戻り値はそのまま JSON で返す。エラーは fail() を投げる。

    function handle(method, pathname, q, body) {
      const [, resource, id, action] = pathname.split('/').filter(Boolean);

      if (resource === 'version' && method === 'GET') return { version: db.version || 0 };

      // 画面の上に出すユニット・部屋の名前
      if (resource === 'settings') {
        if (method === 'GET') return db.settings;
        if (method === 'PUT') {
          db.settings.unitName = str(body.unitName, 40);
          commit();
          return db.settings;
        }
      }

      if (resource === 'categories' && method === 'GET') {
        const used = db.notes.filter((n) => !n.deletedAt).map((n) => n.category);
        return [...new Set([...DEFAULT_CATEGORIES, ...used])].filter(Boolean);
      }

      if (resource === 'summary' && method === 'GET') return monthSummary(q);

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
        // 削除 → その人の記録・予定をすべていっしょにゴミ箱へ。枠は空きになる
        // （先に1件ずつ消してゴミ箱にあったものも、この人の分としてまとめる）
        if (method === 'DELETE' && !action && !p.deletedAt) {
          p.deletedAt = now();
          p.formerSlot = p.slot;
          p.slot = null;
          for (const x of [...db.notes, ...db.events]) {
            if (x.patientId !== p.id || x.deletedWithPatient) continue;
            if (x.deletedAt) x.deletedBefore = true;
            else x.deletedAt = p.deletedAt;
            x.deletedWithPatient = p.id;
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
          for (const x of [...db.notes, ...db.events]) {
            if (x.deletedWithPatient !== p.id) continue;
            // 前から1件ずつ消していたものは、ゴミ箱に残す
            if (!x.deletedBefore) delete x.deletedAt;
            delete x.deletedWithPatient;
            delete x.deletedBefore;
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

      if (resource === 'events') {
        if (method === 'GET' && !id) {
          const from = str(q.get('from'), 10);
          const to = str(q.get('to'), 10);
          if (!isDate(from) || !isDate(to) || from > to) throw fail(400, '日付が正しくありません');
          if (parseDate(to) - parseDate(from) > 100 * 86400000) throw fail(400, '期間が長すぎます');
          return eventsBetween(from, to);
        }
        if (method === 'POST' && !id) {
          const e = { id: newId(), ...cleanEvent(body), createdAt: now(), updatedAt: now() };
          db.events.push(e);
          commit();
          return e;
        }
        const e = db.events.find((x) => x.id === id);
        if (!e) throw fail(404, '予定が見つかりません');
        if (method === 'GET' && !action) return e;
        if (method === 'PUT' && !action && !e.deletedAt) {
          Object.assign(e, cleanEvent(body), { updatedAt: now() });
          commit();
          return e;
        }
        if (method === 'DELETE' && !action && !e.deletedAt) {
          e.deletedAt = now();
          commit();
          return { ok: true };
        }
        if (method === 'POST' && action === 'restore' && e.deletedAt && !e.deletedWithPatient) {
          if (e.patientId && !activePatient(e.patientId)) throw fail(400, 'この予定の利用者はもういません');
          delete e.deletedAt;
          commit();
          return e;
        }
        if (method === 'DELETE' && action === 'purge' && e.deletedAt && !e.deletedWithPatient) {
          purgeEvents([e]);
          commit();
          return { ok: true };
        }
      }

      throw fail(404, '見つかりません');
    }

    return { db, handle, purgeExpiredTrash };
  }

  return { createStore, localDate, fail, DEFAULT_CATEGORIES };
});
