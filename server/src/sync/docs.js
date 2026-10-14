// Portable sync documents. Every document is keyed by codes (company code, SKU code, user email),
// never by local database ids, so desktop installs and the hub can exchange them safely.
import crypto from 'node:crypto';
import { db, tx, plainAll, plain, getSettings } from '../db.js';
import * as P from '../periods.js';

const sortKeys = (v) => {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  return v;
};
export const hashOf = (p) => crypto.createHash('sha1').update(JSON.stringify(sortKeys(p ?? null))).digest('hex');

export const PUSHABLE = new Set(['setup', 'skus', 'budget', 'week', 'month']);
export const COMPANY_DOCS = new Set(['setup', 'skus', 'budget', 'week', 'month']);

function maps() {
  const nodes = plainAll(db.prepare('SELECT id, code FROM nodes').all());
  const skus = plainAll(db.prepare('SELECT id, company_id, code FROM skus').all());
  const users = plainAll(db.prepare('SELECT id, email FROM users').all());
  return {
    nodeCode: new Map(nodes.map((n) => [n.id, n.code])), nodeId: new Map(nodes.map((n) => [n.code, n.id])),
    skuCode: new Map(skus.map((s) => [s.id, s.code])), skuId: new Map(skus.map((s) => [`${s.company_id}|${s.code}`, s.id])),
    userEmail: new Map(users.map((u) => [u.id, u.email.toLowerCase()])), userId: new Map(users.map((u) => [u.email.toLowerCase(), u.id])),
  };
}

// ---- SKU item keys: local "SKU:<id>:PQ" <-> portable "SKU#<code>:PQ"
const outItem = (M, k) => { const m = /^SKU:(\d+):(PQ|SQ|SV)$/.exec(k); return m ? `SKU#${M.skuCode.get(Number(m[1])) ?? m[1]}:${m[2]}` : k; };
const inItem = (M, cid, k) => { const m = /^SKU#(.+):(PQ|SQ|SV)$/.exec(k); if (!m) return k; const id = M.skuId.get(`${cid}|${m[1]}`); return id ? `SKU:${id}:${m[2]}` : null; };
const mapKeys = (obj, f) => { const o = {}; for (const [k, v] of Object.entries(obj || {})) { const nk = f(k); if (nk != null) o[nk] = v; } return o; };
function mapData(d, f) {
  if (!d) return d;
  const o = { ...d, values: mapKeys(d.values, f), adj: mapKeys(d.adj, f), notes: mapKeys(d.notes, f) };
  if (d.reported) o.reported = Object.fromEntries(Object.entries(d.reported).map(([m, v]) => [m, mapKeys(v, f)]));
  return o;
}

// ---------------------------------------------------------------- list

export function listKeys() {
  const out = [{ type: 'config', key: 'all' }, { type: 'users', key: 'all' }];
  const companies = plainAll(db.prepare("SELECT id, code FROM nodes WHERE type = 'company'").all());
  const code = new Map(companies.map((c) => [c.id, c.code]));
  for (const n of plainAll(db.prepare('SELECT code FROM nodes').all())) out.push({ type: 'node', key: n.code });
  for (const s of plainAll(db.prepare('SELECT company_id FROM company_setup').all())) out.push({ type: 'setup', key: code.get(s.company_id) });
  for (const s of plainAll(db.prepare('SELECT DISTINCT company_id FROM skus').all())) out.push({ type: 'skus', key: code.get(s.company_id) });
  const fyStart = Number(getSettings().fiscal_year_start_month || 7);
  const fys = new Set();
  for (const b of plainAll(db.prepare('SELECT DISTINCT company_id, fy FROM budget_annual').all())) fys.add(`${code.get(b.company_id)}|${b.fy}`);
  for (const b of plainAll(db.prepare('SELECT DISTINCT company_id, month_key FROM budget_month').all())) fys.add(`${code.get(b.company_id)}|${P.fyStart(b.month_key, fyStart).slice(0, 4)}`);
  for (const k of fys) out.push({ type: 'budget', key: k });
  for (const r of plainAll(db.prepare('SELECT company_id, week_key FROM reports').all())) out.push({ type: 'week', key: `${code.get(r.company_id)}|${r.week_key}` });
  for (const r of plainAll(db.prepare('SELECT company_id, month_key FROM month_reports').all())) out.push({ type: 'month', key: `${code.get(r.company_id)}|${r.month_key}` });
  return out.filter((x) => x.key && !x.key.startsWith('undefined'));
}

export const companyOf = (type, key) => (COMPANY_DOCS.has(type) ? key.split('|')[0] : null);

// ---------------------------------------------------------------- read

function logOut(M, kind, cid, period) {
  return plainAll(db.prepare('SELECT * FROM workflow_log WHERE kind = ? AND company_id = ? AND period = ? ORDER BY id').all(kind, cid, period))
    .map((l) => ({ uid: l.uid, action: l.action, from: l.from_status, to: l.to_status, user: M.userEmail.get(l.user_id) || l.user_email || null, name: l.user_name || null, comment: l.comment, at: l.at }));
}

export function getDoc(type, key, M = maps()) {
  if (type === 'config') {
    const s = getSettings();
    for (const k of Object.keys(s)) if (k === 'jwt_secret' || k.startsWith('sync_')) delete s[k];
    const lines = plainAll(db.prepare('SELECT l.*, p.code AS parent FROM lines l LEFT JOIN lines p ON p.id = l.parent_id ORDER BY l.sort, l.id').all())
      .map(({ id, parent_id, ...l }) => l);
    return { settings: s, sections: plainAll(db.prepare('SELECT * FROM sections ORDER BY sort').all()), lines };
  }
  if (type === 'users') {
    const scopes = plainAll(db.prepare('SELECT s.user_id, n.code FROM user_scopes s JOIN nodes n ON n.id = s.node_id').all());
    return plainAll(db.prepare('SELECT id, name, email, password_hash, role, title, active FROM users ORDER BY email').all())
      .map(({ id, ...u }) => ({ ...u, email: u.email.toLowerCase(), scopes: scopes.filter((s) => s.user_id === id).map((s) => s.code).sort() }));
  }
  if (type === 'node') {
    const n = plain(db.prepare('SELECT * FROM nodes WHERE code = ?').get(key));
    if (!n) return null;
    return { type: n.type, code: n.code, name: n.name, currency: n.currency, sort: n.sort, active: n.active, meta: JSON.parse(n.meta || '{}'), parent: M.nodeCode.get(n.parent_id) || null };
  }
  const cid = M.nodeId.get(companyOf(type, key));
  if (!cid) return null;
  if (type === 'setup') {
    const s = db.prepare('SELECT start_week, opening_cash FROM company_setup WHERE company_id = ?').get(cid);
    return s ? { ...s } : null;
  }
  if (type === 'skus') {
    return plainAll(db.prepare('SELECT code, name, unit, sort, active FROM skus WHERE company_id = ? ORDER BY code').all(cid));
  }
  if (type === 'budget') {
    const fy = Number(key.split('|')[1]);
    const months = P.fyAllMonths(fy, Number(getSettings().fiscal_year_start_month || 7));
    const annual = {};
    for (const b of plainAll(db.prepare('SELECT item, value FROM budget_annual WHERE company_id = ? AND fy = ?').all(cid, fy))) annual[outItem(M, b.item)] = b.value;
    const bym = {};
    for (const b of plainAll(db.prepare(`SELECT month_key, item, value FROM budget_month WHERE company_id = ? AND month_key IN (${months.map(() => '?').join(',')})`).all(cid, ...months))) {
      (bym[b.month_key] ||= {})[outItem(M, b.item)] = b.value;
    }
    return { annual, months: bym };
  }
  if (type === 'week' || type === 'month') {
    const period = key.split('|')[1];
    const [rt, kc, vt, ft] = type === 'week' ? ['reports', 'week_key', 'report_values', 'filings'] : ['month_reports', 'month_key', 'month_values', 'month_filings'];
    const r = plain(db.prepare(`SELECT * FROM ${rt} WHERE company_id = ? AND ${kc} = ?`).get(cid, period));
    if (!r) return null;
    const f = (k) => outItem(M, k);
    let data;
    if (type === 'week') {
      data = { values: {}, adj: {}, notes: {} };
      for (const v of plainAll(db.prepare('SELECT * FROM report_values WHERE report_id = ?').all(r.id))) if (v.value != null) (data.values[f(v.item)] ||= {})[v.month_key] = v.value;
      for (const a of plainAll(db.prepare('SELECT * FROM report_adj WHERE report_id = ?').all(r.id))) data.adj[f(a.item)] = { value: a.value, reason: a.reason };
      for (const n of plainAll(db.prepare('SELECT * FROM report_notes WHERE report_id = ?').all(r.id))) data.notes[f(n.item)] = n.note;
    } else {
      data = { values: {} };
      for (const v of plainAll(db.prepare('SELECT * FROM month_values WHERE report_id = ?').all(r.id))) if (v.value != null) data.values[v.item] = v.value;
    }
    const filings = plainAll(db.prepare(`SELECT * FROM ${ft} WHERE company_id = ? AND ${kc} = ? ORDER BY revision`).all(cid, period))
      .map((x) => ({ uid: x.uid, revision: x.revision, currency: x.currency || null, data: type === 'week' ? mapData(JSON.parse(x.data_json), f) : JSON.parse(x.data_json), by: M.userEmail.get(x.filed_by) || x.filed_by_email || null, at: x.filed_at }));
    return { status: r.status, revision: r.revision, reopened: r.reopened, remarks: r.remarks || '', data, filings, log: logOut(M, type, cid, period) };
  }
  return null;
}

// ---------------------------------------------------------------- write

export function applyDoc(type, key, p) {
  return tx(() => applyInner(type, key, p));
}

function applyInner(type, key, p) {
  let M = maps();
  if (type === 'config') {
    const up = db.prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    for (const [k, v] of Object.entries(p.settings || {})) if (k !== 'jwt_secret' && !k.startsWith('sync_')) up.run(k, v);
    for (const s of p.sections || []) {
      db.prepare('INSERT INTO sections(code, name, scope, sort) VALUES (?,?,?,?) ON CONFLICT(code) DO UPDATE SET name=excluded.name, scope=excluded.scope, sort=excluded.sort')
        .run(s.code, s.name, s.scope, s.sort);
    }
    const cols = ['name', 'section', 'kind', 'scope', 'cf', 'formula', 'nature', 'fmt', 'hib', 'budget', 'note_required', 'is_kpi', 'system', 'sort', 'active'];
    for (const l of p.lines || []) {
      db.prepare(`INSERT INTO lines(code, ${cols.join(',')}) VALUES (?, ${cols.map(() => '?').join(',')})
        ON CONFLICT(code) DO UPDATE SET ${cols.map((c) => `${c}=excluded.${c}`).join(', ')}`).run(l.code, ...cols.map((c) => l[c] ?? null));
    }
    for (const l of p.lines || []) {
      db.prepare('UPDATE lines SET parent_id = (SELECT id FROM lines WHERE code = ?) WHERE code = ?').run(l.parent, l.code);
    }
    return;
  }
  if (type === 'users') {
    for (const u of p || []) {
      const ex = db.prepare('SELECT id FROM users WHERE email = ? COLLATE NOCASE').get(u.email);
      let id = ex?.id;
      if (id) db.prepare('UPDATE users SET name=?, password_hash=?, role=?, title=?, active=? WHERE id=?').run(u.name, u.password_hash, u.role, u.title, u.active, id);
      else id = Number(db.prepare('INSERT INTO users(name, email, password_hash, role, title, active) VALUES (?,?,?,?,?,?)').run(u.name, u.email, u.password_hash, u.role, u.title, u.active).lastInsertRowid);
      db.prepare('DELETE FROM user_scopes WHERE user_id = ?').run(id);
      for (const c of u.scopes || []) { const nid = M.nodeId.get(c); if (nid) db.prepare('INSERT OR IGNORE INTO user_scopes(user_id, node_id) VALUES (?,?)').run(id, nid); }
    }
    return;
  }
  if (type === 'node') {
    const parent = p.parent ? M.nodeId.get(p.parent) ?? null : null;
    const ex = db.prepare('SELECT id FROM nodes WHERE code = ?').get(key);
    if (ex) db.prepare('UPDATE nodes SET parent_id=?, type=?, name=?, currency=?, sort=?, active=?, meta=? WHERE id=?').run(parent, p.type, p.name, p.currency, p.sort, p.active, JSON.stringify(p.meta || {}), ex.id);
    else db.prepare('INSERT INTO nodes(parent_id, type, code, name, currency, sort, active, meta) VALUES (?,?,?,?,?,?,?,?)').run(parent, p.type, p.code, p.name, p.currency, p.sort, p.active, JSON.stringify(p.meta || {}));
    return;
  }
  const cid = M.nodeId.get(companyOf(type, key));
  if (!cid) throw new Error(`Unknown company ${companyOf(type, key)}`);
  if (type === 'setup') {
    if (!p) db.prepare('DELETE FROM company_setup WHERE company_id = ?').run(cid);
    else db.prepare(`INSERT INTO company_setup(company_id, start_week, opening_cash) VALUES (?,?,?)
      ON CONFLICT(company_id) DO UPDATE SET start_week = excluded.start_week, opening_cash = excluded.opening_cash, updated_at = datetime('now')`).run(cid, p.start_week, p.opening_cash);
    return;
  }
  if (type === 'skus') {
    const codes = new Set((p || []).map((s) => s.code));
    for (const s of p || []) {
      db.prepare(`INSERT INTO skus(company_id, code, name, unit, sort, active) VALUES (?,?,?,?,?,?)
        ON CONFLICT(company_id, code) DO UPDATE SET name=excluded.name, unit=excluded.unit, sort=excluded.sort, active=excluded.active`).run(cid, s.code, s.name, s.unit, s.sort, s.active);
    }
    for (const s of plainAll(db.prepare('SELECT id, code FROM skus WHERE company_id = ?').all(cid))) if (!codes.has(s.code)) db.prepare('UPDATE skus SET active = 0 WHERE id = ?').run(s.id);
    return;
  }
  M = maps();
  const f = (k) => inItem(M, cid, k);
  if (type === 'budget') {
    const fy = Number(key.split('|')[1]);
    const months = P.fyAllMonths(fy, Number(getSettings().fiscal_year_start_month || 7));
    db.prepare('DELETE FROM budget_annual WHERE company_id = ? AND fy = ?').run(cid, fy);
    db.prepare(`DELETE FROM budget_month WHERE company_id = ? AND month_key IN (${months.map(() => '?').join(',')})`).run(cid, ...months);
    for (const [k, v] of Object.entries(p?.annual || {})) { const it = f(k); if (it) db.prepare('INSERT INTO budget_annual(company_id, fy, item, value) VALUES (?,?,?,?)').run(cid, fy, it, v); }
    for (const [mo, items] of Object.entries(p?.months || {})) for (const [k, v] of Object.entries(items)) { const it = f(k); if (it) db.prepare('INSERT INTO budget_month(company_id, month_key, item, value) VALUES (?,?,?,?)').run(cid, mo, it, v); }
    return;
  }
  if (type === 'week' || type === 'month') {
    const period = key.split('|')[1];
    const [rt, kc, vt, ft] = type === 'week' ? ['reports', 'week_key', 'report_values', 'filings'] : ['month_reports', 'month_key', 'month_values', 'month_filings'];
    if (!p) return;
    let r = db.prepare(`SELECT id FROM ${rt} WHERE company_id = ? AND ${kc} = ?`).get(cid, period);
    if (r) db.prepare(`UPDATE ${rt} SET status=?, revision=?, reopened=?, remarks=?, updated_at=datetime('now') WHERE id=?`).run(p.status, p.revision, p.reopened || 0, p.remarks || '', r.id);
    else r = { id: Number(db.prepare(`INSERT INTO ${rt}(company_id, ${kc}, status, revision, reopened, remarks) VALUES (?,?,?,?,?,?)`).run(cid, period, p.status, p.revision, p.reopened || 0, p.remarks || '').lastInsertRowid) };
    if (type === 'week') {
      for (const t of ['report_values', 'report_adj', 'report_notes']) db.prepare(`DELETE FROM ${t} WHERE report_id = ?`).run(r.id);
      for (const [k, byM] of Object.entries(p.data?.values || {})) { const it = f(k); if (it) for (const [mo, v] of Object.entries(byM)) db.prepare('INSERT INTO report_values(report_id, item, month_key, value) VALUES (?,?,?,?)').run(r.id, it, mo, v); }
      for (const [k, a] of Object.entries(p.data?.adj || {})) { const it = f(k); if (it) db.prepare('INSERT INTO report_adj(report_id, item, value, reason) VALUES (?,?,?,?)').run(r.id, it, a.value, a.reason || ''); }
      for (const [k, n] of Object.entries(p.data?.notes || {})) { const it = f(k); if (it) db.prepare('INSERT INTO report_notes(report_id, item, note) VALUES (?,?,?)').run(r.id, it, n); }
    } else {
      db.prepare('DELETE FROM month_values WHERE report_id = ?').run(r.id);
      for (const [k, v] of Object.entries(p.data?.values || {})) db.prepare('INSERT INTO month_values(report_id, item, value) VALUES (?,?,?)').run(r.id, k, v);
    }
    db.prepare(`DELETE FROM ${ft} WHERE company_id = ? AND ${kc} = ?`).run(cid, period);
    for (const x of renumber(p.filings || [])) {
      const data = type === 'week' ? mapData(x.data, f) : x.data;
      if (type === 'week') {
        db.prepare('INSERT INTO filings(uid, report_id, company_id, week_key, revision, currency, data_json, filed_by, filed_by_email, filed_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
          .run(x.uid || null, r.id, cid, period, x.revision, x.currency || 'PKR', JSON.stringify(data), M.userId.get(x.by) ?? null, x.by, x.at);
      } else {
        db.prepare('INSERT INTO month_filings(uid, report_id, company_id, month_key, revision, data_json, filed_by, filed_by_email, filed_at) VALUES (?,?,?,?,?,?,?,?,?)')
          .run(x.uid || null, r.id, cid, period, x.revision, JSON.stringify(data), M.userId.get(x.by) ?? null, x.by, x.at);
      }
    }
    db.prepare('DELETE FROM workflow_log WHERE kind = ? AND company_id = ? AND period = ?').run(type, cid, period);
    for (const l of dedupeLog(p.log || [])) {
      db.prepare('INSERT INTO workflow_log(uid, kind, company_id, period, action, from_status, to_status, user_id, user_email, user_name, comment, at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(l.uid || null, type, cid, period, l.action, l.from, l.to, M.userId.get(l.user) ?? null, l.user, l.name ?? null, l.comment, l.at);
    }
    // the report's revision follows its newest filing
    const top = db.prepare(`SELECT MAX(revision) r FROM ${ft} WHERE company_id = ? AND ${kc} = ?`).get(cid, period).r;
    if (top != null && top !== p.revision) db.prepare(`UPDATE ${rt} SET revision = ? WHERE id = ?`).run(top, r.id);
  }
}

// ---------------------------------------------------------------- merge (hub side) for report documents

const RANK = { new: 0, draft: 0, reopened: 0, submitted: 1, company_ok: 2, cluster_ok: 3, approved: 4 };
const LOCKEDS = new Set(['submitted', 'company_ok', 'cluster_ok', 'approved']);
const EDITING = new Set(['new', 'draft', 'reopened']);
const logKey = (l) => l.uid || `${l.action}|${l.at}|${l.user}`;
const filingKey = (f) => f.uid || `${f.revision}|${f.at}`;
const byTime = (x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0);
export function dedupeLog(list) {
  const seen = new Set();
  return list.filter((l) => { const k = logKey(l); if (seen.has(k)) return false; seen.add(k); return true; }).sort(byTime);
}
// one entry per unique filing; revisions renumbered 1..n in filing order so they can never clash
export function renumber(list) {
  const m = new Map();
  for (const f of list) if (!m.has(filingKey(f))) m.set(filingKey(f), f);
  return [...m.values()].sort((x, y) => (x.revision - y.revision) || byTime(x, y)).map((f, i) => ({ ...f, revision: i + 1 }));
}
const unionLog = (a = [], b = []) => dedupeLog([...a, ...b]);
const unionFilings = (a = [], b = []) => renumber([...a, ...b].sort(byTime));

// Returns { doc } to store, or { reject: true } when the hub's version must win
export function mergeReport(cur, inc) {
  if (!cur) return { doc: { ...inc, filings: renumber(inc.filings || []), log: dedupeLog(inc.log || []) } };
  const log = unionLog(cur.log, inc.log);
  const filings = unionFilings(cur.filings, inc.filings);
  const reopened = Math.max(cur.reopened || 0, inc.reopened || 0);
  const known = new Set((cur.filings || []).map(filingKey));
  const fresh = (inc.filings || []).filter((f) => !known.has(filingKey(f)));
  if (fresh.length) {
    // a submission the hub has not seen: keep every version, the newest becomes current and goes through review again
    const revision = filings.length ? filings[filings.length - 1].revision : inc.revision;
    return { doc: { ...inc, status: LOCKEDS.has(inc.status) ? inc.status : 'submitted', revision, log, filings, reopened } };
  }
  if (inc.revision > cur.revision) {
    // a newer submission made offline: accept it unless the hub has since reopened that very submission
    return { doc: { ...inc, log, filings, reopened } };
  }
  if (inc.revision === cur.revision) {
    if (EDITING.has(cur.status) && EDITING.has(inc.status)) {
      // both still in entry: keep the entered figures, keep the hub's workflow state (e.g. reopened by group reviewer)
      return { doc: { ...cur, data: inc.data, remarks: inc.remarks, log, filings, reopened } };
    }
    if (RANK[inc.status] > RANK[cur.status] && cur.status !== 'reopened') {
      // approval made offline
      return { doc: { ...cur, status: inc.status, log, filings, reopened } };
    }
  }
  return { reject: true };
}
