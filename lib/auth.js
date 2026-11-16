'use strict';
// ログイン（10アカウント：8ユニット＋看護師＋ケアマネジャー）と、だれが何をしてよいかの決まり。
// ・アカウントは data/accounts.json、ログイン中の端末は data/sessions.json に保存する
// ・パスワードはそのままでは保存しない（scrypt でハッシュにする）
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const COOKIE = 'kaigo_sid';
const UNIT_SESSION_MS = 30 * 86400000; // ユニットの端末は30日ログインしたまま
const STAFF_SESSION_MS = 12 * 3600000; // 看護師・ケアマネジャーは12時間
const MIN_PASSWORD = 4;
const MAX_FAILS = 5; // 5回まちがえたら1分待つ
const LOCK_MS = 60000;

function fail(status, message, code, params) {
  return Object.assign(new Error(message), { status, code, params });
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(String(password), salt, 32).toString('hex') };
}

function createAuth({ dataDir, units, log = console.log }) {
  const accountsFile = path.join(dataDir, 'accounts.json');
  const sessionsFile = path.join(dataDir, 'sessions.json');
  fs.mkdirSync(dataDir, { recursive: true });

  let accounts = [];
  let accountsMtime = 0;
  let sessions = {}; // sha256(token) -> { id, expires }
  const fails = new Map(); // accountId -> { n, until }

  function writeJson(file, data) {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 1));
    try {
      fs.renameSync(tmp, file);
    } catch {
      fs.writeFileSync(file, JSON.stringify(data, null, 1));
      fs.rmSync(tmp, { force: true });
    }
  }

  function saveAccounts() {
    writeJson(accountsFile, accounts);
    accountsMtime = fs.statSync(accountsFile).mtimeMs;
  }

  // はじめのアカウント：ID とパスワードは同じ（例：kaki / kaki）。あとで自分で変える
  function defaults() {
    const make = (id, role, name, unit) => ({ id, role, unit: unit || null, name, ...hashPassword(id), mustChange: true });
    return [...units.map((u) => make(u.id, 'unit', u.name, u.id)), make('nurse', 'nurse', '看護師'), make('care', 'care', 'ケアマネジャー')];
  }

  function loadAccounts() {
    let list = [];
    try {
      list = JSON.parse(fs.readFileSync(accountsFile, 'utf8'));
      accountsMtime = fs.statSync(accountsFile).mtimeMs;
    } catch {}
    // 足りないアカウント（はじめての起動、units.json にユニットを足したとき）を作る
    let changed = false;
    for (const d of defaults()) {
      if (!list.some((a) => a.id === d.id)) {
        list.push(d);
        changed = true;
        log(`  [ログイン] アカウントを作りました: ${d.id}（はじめのパスワードは ID と同じ）`);
      }
    }
    accounts = list;
    if (changed) saveAccounts();
  }

  // tools/reset-password.js がファイルを書きかえたら、読みなおす
  function refreshIfChanged() {
    try {
      if (fs.statSync(accountsFile).mtimeMs !== accountsMtime) loadAccounts();
    } catch {}
  }

  function loadSessions() {
    try {
      sessions = JSON.parse(fs.readFileSync(sessionsFile, 'utf8'));
    } catch {
      sessions = {};
    }
    pruneSessions();
  }
  function saveSessions() {
    writeJson(sessionsFile, sessions);
  }
  function pruneSessions() {
    const now = Date.now();
    let n = 0;
    for (const k of Object.keys(sessions)) {
      if (sessions[k].expires < now || !accounts.some((a) => a.id === sessions[k].id)) {
        delete sessions[k];
        n++;
      }
    }
    if (n) saveSessions();
  }

  const tokenKey = (token) => crypto.createHash('sha256').update(token).digest('hex');
  const account = (id) => accounts.find((a) => a.id === id);
  // 画面に渡してよい形（パスワードのハッシュは出さない）
  const view = (a) => ({ id: a.id, role: a.role, unit: a.unit, name: a.name, mustChange: Boolean(a.mustChange) });

  function parseCookie(req) {
    const m = new RegExp('(?:^|;\\s*)' + COOKIE + '=([a-f0-9]{64})').exec(req.headers.cookie || '');
    return m ? m[1] : '';
  }

  // このリクエストは、だれのログインか（ログインしていなければ null）
  function who(req) {
    const token = parseCookie(req);
    if (!token) return null;
    const s = sessions[tokenKey(token)];
    if (!s || s.expires < Date.now()) return null;
    const a = account(s.id);
    return a ? view(a) : null;
  }

  function checkPassword(a, password) {
    const h = crypto.scryptSync(String(password), a.salt, 32);
    const stored = Buffer.from(a.hash, 'hex');
    return h.length === stored.length && crypto.timingSafeEqual(h, stored);
  }

  function login(id, password) {
    refreshIfChanged();
    const a = account(String(id || ''));
    if (!a) throw fail(401, 'IDかパスワードがちがいます', 'loginFailed');
    const f = fails.get(a.id);
    if (f && f.until > Date.now()) throw fail(429, 'まちがいが続いたので、1分待ってください', 'loginLocked');
    if (!checkPassword(a, password)) {
      const n = (f && f.n < MAX_FAILS ? f.n : 0) + 1; // 待ち時間が終わったら、また1回目から数える
      fails.set(a.id, { n, until: n >= MAX_FAILS ? Date.now() + LOCK_MS : 0 });
      if (n >= MAX_FAILS) log(`  [ログイン] ${a.id}: パスワードのまちがいが ${n} 回続きました`);
      throw fail(401, 'IDかパスワードがちがいます', 'loginFailed');
    }
    fails.delete(a.id);
    const token = crypto.randomBytes(32).toString('hex');
    const ms = a.role === 'unit' ? UNIT_SESSION_MS : STAFF_SESSION_MS;
    sessions[tokenKey(token)] = { id: a.id, expires: Date.now() + ms };
    pruneSessions();
    saveSessions();
    return { account: view(a), cookie: `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(ms / 1000)}` };
  }

  function logout(req) {
    const token = parseCookie(req);
    if (token && sessions[tokenKey(token)]) {
      delete sessions[tokenKey(token)];
      saveSessions();
    }
    return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
  }

  function cleanPassword(pw) {
    const v = String(pw || '');
    if (v.length < MIN_PASSWORD) throw fail(400, `パスワードは${MIN_PASSWORD}文字以上にしてください`, 'passwordShort', { n: MIN_PASSWORD });
    if (v.length > 100) throw fail(400, 'パスワードが長すぎます', 'passwordLong');
    return v;
  }

  // そのアカウントの、ほかの端末のログインを切る（パスワードを変えたとき）
  function dropSessions(id, exceptReq) {
    const keep = exceptReq ? tokenKey(parseCookie(exceptReq)) : '';
    for (const k of Object.keys(sessions)) if (sessions[k].id === id && k !== keep) delete sessions[k];
    saveSessions();
  }

  // 自分のパスワードを変える
  function changeOwnPassword(req, me, current, next) {
    const a = account(me.id);
    if (!checkPassword(a, current)) throw fail(400, '今のパスワードがちがいます', 'passwordWrong');
    Object.assign(a, hashPassword(cleanPassword(next)), { mustChange: false });
    saveAccounts();
    dropSessions(a.id, req);
    return view(a);
  }

  // ケアマネジャー（管理者）が、名前を変える・パスワードをリセットする
  function adminUpdate(me, id, body) {
    if (me.role !== 'care') throw fail(403, 'ケアマネジャーだけができます', 'adminOnly');
    const a = account(id);
    if (!a) throw fail(404, '見つかりません', 'notFound');
    if (body.name !== undefined) {
      const name = String(body.name).trim().slice(0, 40);
      if (!name) throw fail(400, '名前を入力してください', 'nameRequired');
      a.name = name;
    }
    if (body.password !== undefined && body.password !== '') {
      Object.assign(a, hashPassword(cleanPassword(body.password)), { mustChange: a.id !== me.id });
      if (a.id !== me.id) dropSessions(a.id);
    }
    saveAccounts();
    return view(a);
  }

  // ログイン画面に出す一覧（だれでも見られる。名前と種類だけ）
  const publicList = () => accounts.map((a) => ({ id: a.id, role: a.role, unit: a.unit, name: a.name }));
  const adminList = (me) => {
    if (me.role !== 'care') throw fail(403, 'ケアマネジャーだけができます', 'adminOnly');
    return accounts.map(view);
  };

  // ---------- ユニットの記録に対して、何をしてよいか ----------
  // ・ユニットのアカウント：自分のユニットは全部できる。ほかのユニットは「日付・利用者・予定」を見て、記録を書きたすことだけできる
  //   （夜勤で2ユニットを見るため。書いた人の名前は自動で自分のユニット名になる。直せるのは自分が書いた記録だけ。消すことはできない）
  // ・看護師・ケアマネジャー：どのユニットも見られる。記録と予定を書ける。直せるのは自分が書いたものだけ。消すことはできない
  // ・消す・ゴミ箱・利用者の登録・ユニットの設定は、そのユニットのアカウントだけ（記録はユニットがいちばん強い）
  function perms(me, unitId) {
    const owner = me.role === 'unit' && me.unit === unitId;
    const staff = me.role === 'nurse' || me.role === 'care';
    const otherUnit = !owner && !staff;
    return { owner, staff, canWrite: owner || staff, canAddNote: true, canDelete: owner, canManage: owner, viewOnly: otherUnit, addOnly: otherUnit };
  }

  // store は、直そうとしている記録・予定を作ったアカウントを調べるために使う
  function authorize(me, unitId, method, parts, store) {
    const p = perms(me, unitId);
    const [, resource, id, action] = parts; // ['api', 'notes', id?, action?]
    const deny = (code) => {
      throw fail(403, 'この操作はできません', code);
    };
    if (method === 'GET') {
      if (p.owner) return p;
      if (resource === 'inbox') deny('ownerOnly');
      if (resource === 'trash') deny('ownerOnly');
      if (p.viewOnly && resource === 'summary') deny('readOnly');
      return p;
    }
    if (p.owner) return p;
    if (p.viewOnly) {
      // ほかのユニット：記録を書きたす（写真も）。直せるのは、自分のユニットが書いた記録だけ。消すことはできない
      if ((resource === 'notes' && method === 'POST' && !id) || (resource === 'upload' && method === 'POST')) return p;
      if (resource === 'notes' && method === 'PUT' && id && !action) {
        const item = store.db.notes.find((x) => x.id === id);
        if (item && item.createdBy === me.id) return p;
        deny('ownNotesOnly');
      }
      deny('readOnly');
    }
    // ここからは看護師・ケアマネジャー
    if (resource === 'upload' && method === 'POST') return p;
    if (resource === 'notes' || resource === 'events') {
      if (method === 'POST' && !id) return p;
      if (method === 'PUT' && id && !action) {
        const list = resource === 'notes' ? store.db.notes : store.db.events;
        const item = list.find((x) => x.id === id);
        if (item && item.createdBy === me.id) return p;
        deny('ownNotesOnly');
      }
    }
    deny('ownerOnly');
    return p;
  }

  loadAccounts();
  loadSessions();

  return { who, login, logout, changeOwnPassword, adminUpdate, publicList, adminList, perms, authorize, view, hashPassword, MIN_PASSWORD };
}

module.exports = { createAuth, hashPassword, MIN_PASSWORD };
