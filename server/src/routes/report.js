import { Router } from 'express';
import { db, tx, audit, plain, plainAll } from '../db.js';
import { canView, canPrepare, actions } from '../auth.js';
import { Engine, pathOf } from '../engine.js';
import { LOCKED, act, log, history } from '../workflow.js';
import * as P from '../periods.js';
import { h, bad, forbidden, notFound, num } from './util.js';
import { offlineNode } from '../sync/state.js';

const r = Router();
const DAY = 86400000;

function load(req) {
  const { cid, week } = req.params;
  if (!P.isWeek(week)) throw bad('Invalid week');
  const c = db.prepare("SELECT * FROM nodes WHERE id = ? AND type = 'company'").get(Number(cid));
  if (!c) throw notFound('Company not found');
  return { c: { ...c }, W: week };
}

const getReport = (cid, W) => plain(db.prepare('SELECT * FROM reports WHERE company_id = ? AND week_key = ?').get(cid, W));

// A week is frozen once any month it touches has been submitted at month close
export function monthLocked(cid, W) {
  return P.segments(W).some((s) => LOCKED.has(db.prepare('SELECT status FROM month_reports WHERE company_id = ? AND month_key = ?').get(cid, s.month)?.status));
}

function draftData(rep) {
  const d = { values: {}, adj: {}, notes: {}, remarks: rep?.remarks || '' };
  if (!rep) return d;
  for (const v of plainAll(db.prepare('SELECT * FROM report_values WHERE report_id = ?').all(rep.id))) if (v.value != null) (d.values[v.item] ||= {})[v.month_key] = v.value;
  for (const a of plainAll(db.prepare('SELECT * FROM report_adj WHERE report_id = ?').all(rep.id))) d.adj[a.item] = { value: a.value, reason: a.reason };
  for (const n of plainAll(db.prepare('SELECT * FROM report_notes WHERE report_id = ?').all(rep.id))) d.notes[n.item] = n.note;
  return d;
}

function cleanInput(eng, c, W, body) {
  const items = new Set(eng.items(c.id));
  const months = P.segments(W).map((s) => s.month);
  const d = { values: {}, adj: {}, notes: {}, remarks: body?.remarks != null ? String(body.remarks).slice(0, 2000) : '' };
  for (const [item, byM] of Object.entries(body?.values || {})) {
    if (!items.has(item)) continue;
    for (const [mo, v] of Object.entries(byM || {})) if (months.includes(mo) && num(v) != null) (d.values[item] ||= {})[mo] = num(v);
  }
  for (const [item, a] of Object.entries(body?.adj || {})) {
    if (!items.has(item) || num(a?.value) == null || num(a.value) === 0) continue;
    d.adj[item] = { value: num(a.value), reason: String(a.reason || '').trim().slice(0, 500) };
  }
  for (const [item, n] of Object.entries(body?.notes || {})) if (items.has(item) && String(n || '').trim()) d.notes[item] = String(n).trim().slice(0, 500);
  return d;
}

function preview(eng, c, W, d) {
  if (d) eng.setDraft(c.id, W, d);
  const out = {};
  for (const s of P.segments(W)) out[s.month] = eng.weekView(c.id, W, s.month, { children: false }).sections;
  return out;
}

const unfiledBefore = (eng, cid, W) => {
  const setup = eng.setup.get(cid);
  return setup && W > setup.start_week ? P.weekRange(setup.start_week, P.shiftWeek(W, -1)).filter((w) => !eng.weekDone(cid, w)) : [];
};

r.get('/report/:cid/:week', h((req) => {
  const { c, W } = load(req);
  if (!canView(req.user, c.id)) throw forbidden();
  const eng = new Engine();
  const setup = eng.setup.get(c.id) || null;
  const rep = getReport(c.id, W);
  const filing = eng.filings.get(`${c.id}|${W}`);
  const status = eng.weekStatus(c.id, W) === 'na' ? (rep?.status || 'new') : eng.weekStatus(c.id, W);
  const locked = LOCKED.has(status);
  const lapsed = status === 'lapsed';
  const d = locked && filing ? { values: filing.values, adj: filing.adj, notes: filing.notes || {}, remarks: filing.remarks || '' }
    : draftData(rep);
  const started = P.weekStart(W) <= new Date();
  const ended = Date.now() >= P.weekEnd(W).getTime() + DAY;
  const mLocked = monthLocked(c.id, W);
  const unfiled = unfiledBefore(eng, c.id, W);

  const recentEnd = P.weekKey();
  const recent = P.weekRange(P.shiftWeek(recentEnd, -11), recentEnd).reverse()
    .filter((w) => !setup || w >= setup.start_week).map((w) => ({ key: w, label: P.weekLabel(w), status: eng.weekStatus(c.id, w), reopened: eng.wreopen.get(`${c.id}|${w}`) || 0 }));

  const prevW = P.shiftWeek(W, -1);
  const pf = eng.filings.get(`${c.id}|${prevW}`);
  const lastWeek = {};
  if (pf) for (const [item, byM] of Object.entries(pf.values || {})) lastWeek[item] = Object.values(byM).reduce((a, v) => a + v, 0);

  return {
    company: { ...c, meta: JSON.parse(c.meta || '{}') }, path: pathOf(eng.tree, c.id), week: P.describeWeek(W),
    due: P.ymd(P.dueDate(W, eng.settings.week_due_days)),
    status, reopened: rep?.reopened || 0, revision: rep?.revision || 0, updated_at: rep?.updated_at || null,
    cutoff: eng.isMonthEndWeek(W) ? null : new Date(eng.cutoff(W)).toISOString(), month_end_week: eng.isMonthEndWeek(W),
    setup, needs_setup: !setup, before_start: !!setup && W < setup.start_week,
    editable: canPrepare(req.user, c.id, eng.tree) && !!setup && W >= setup.start_week && (['new', 'draft', 'reopened'].includes(status) || (status === 'lapsed' && offlineNode())) && !mLocked && started && !!c.active,
    offline_after_cutoff: status === 'lapsed' && offlineNode(),
    month_locked: mLocked,
    can_submit: ended && unfiled.length === 0,
    not_ended: !ended, unfiled,
    actions: mLocked ? [] : actions(req.user, c.id, status, eng.tree),
    log: history('week', c.id, W),
    lines: eng.lines.filter((l) => l.scope === 'week').map((l) => ({ code: l.code, name: l.name, section: l.section, kind: l.kind, note_required: l.note_required })),
    skus: eng.skus.get(c.id) || [],
    data: d,
    last_week: pf ? { key: prevW, values: lastWeek } : null,
    preview: setup && W >= setup.start_week ? preview(eng, c, W, locked ? null : d) : null,
    recent,
  };
}));

r.post('/report/:cid/:week/preview', h((req) => {
  const { c, W } = load(req);
  if (!canView(req.user, c.id)) throw forbidden();
  const eng = new Engine();
  if (!eng.setup.get(c.id)) throw bad('Opening balance not set');
  return preview(eng, c, W, cleanInput(eng, c, W, req.body));
}));

function save(req, c, W, d) {
  if (!canPrepare(req.user, c.id)) throw forbidden('You cannot prepare figures for this company');
  const setup = db.prepare('SELECT * FROM company_setup WHERE company_id = ?').get(c.id);
  if (!setup) throw bad('Set the opening cash & bank balance first');
  if (W < setup.start_week) throw bad(`Reporting starts from ${setup.start_week}`);
  if (P.weekStart(W) > new Date()) throw bad('This week has not started');
  if (monthLocked(c.id, W)) throw bad('Month already closed');
  // Offline desktop installs may keep saving after the cut-off; the figures stay as a draft until the group reviewer reopens
  if (new Engine().weekStatus(c.id, W) === 'lapsed' && !offlineNode()) throw bad('Entry closed at the Monday cut-off. Ask the group reviewer to reopen.');
  let rep = getReport(c.id, W);
  if (rep && LOCKED.has(rep.status)) throw bad('Submitted and locked');
  return tx(() => {
    if (!rep) {
      const info = db.prepare("INSERT INTO reports(company_id, week_key, status, updated_by) VALUES (?,?,'draft',?)").run(c.id, W, req.user.id);
      rep = plain(db.prepare('SELECT * FROM reports WHERE id = ?').get(info.lastInsertRowid));
    }
    for (const t of ['report_values', 'report_adj', 'report_notes']) db.prepare(`DELETE FROM ${t} WHERE report_id = ?`).run(rep.id);
    const iv = db.prepare('INSERT INTO report_values(report_id, item, month_key, value) VALUES (?,?,?,?)');
    for (const [item, byM] of Object.entries(d.values)) for (const [mo, v] of Object.entries(byM)) iv.run(rep.id, item, mo, v);
    const ia = db.prepare('INSERT INTO report_adj(report_id, item, value, reason) VALUES (?,?,?,?)');
    for (const [item, a] of Object.entries(d.adj)) ia.run(rep.id, item, a.value, a.reason || '');
    const inn = db.prepare('INSERT INTO report_notes(report_id, item, note) VALUES (?,?,?)');
    for (const [item, n] of Object.entries(d.notes)) inn.run(rep.id, item, n);
    db.prepare("UPDATE reports SET remarks = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?").run(d.remarks, req.user.id, rep.id);
    return plain(db.prepare('SELECT * FROM reports WHERE id = ?').get(rep.id));
  });
}

r.put('/report/:cid/:week', h((req) => {
  const { c, W } = load(req);
  save(req, c, W, cleanInput(new Engine(), c, W, req.body));
  return { ok: true };
}));

r.post('/report/:cid/:week/submit', h((req) => {
  const { c, W } = load(req);
  const eng = new Engine();
  const d = cleanInput(eng, c, W, req.body);
  // all checks first, so a refused submit never overwrites saved figures
  if (Date.now() < P.weekEnd(W).getTime() + DAY) throw bad('The week has not ended yet');
  if (eng.weekStatus(c.id, W) === 'lapsed') throw bad('Past the cut-off. Saved as draft; the group reviewer must reopen before it can be submitted.');
  const unfiled = unfiledBefore(eng, c.id, W);
  if (unfiled.length) throw bad(`Submit earlier weeks first: ${unfiled.join(', ')}`);
  const noReason = Object.entries(d.adj).filter(([, a]) => !a.reason);
  if (noReason.length) throw bad(`Reason required for adjustment: ${noReason.map(([i]) => eng.itemLabel(i)).join(', ')}`);
  const missingNote = eng.lines.filter((l) => l.note_required).map((l) => l.code)
    .filter((code) => Object.values(d.values[code] || {}).some((v) => v) && !d.notes[code]);
  if (missingNote.length) throw bad(`Explain: ${missingNote.map((x) => eng.itemLabel(x)).join(', ')}`);
  if (!Object.keys(d.values).length) throw bad('No figures entered');
  const rep = save(req, c, W, d);

  eng.setDraft(c.id, W, d);
  const reported = {};
  for (const s of P.segments(W)) reported[s.month] = eng.companyVectors(c, W, s.month, false).V.mtdA;
  const revision = (db.prepare('SELECT MAX(revision) r FROM filings WHERE company_id = ? AND week_key = ?').get(c.id, W).r || 0) + 1;
  tx(() => {
    db.prepare('INSERT INTO filings(report_id, company_id, week_key, revision, currency, data_json, filed_by) VALUES (?,?,?,?,?,?,?)')
      .run(rep.id, c.id, W, revision, c.currency, JSON.stringify({ ...d, reported }), req.user.id);
    db.prepare("UPDATE reports SET status = 'submitted', revision = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?").run(revision, req.user.id, rep.id);
    log('week', c.id, W, 'submit', rep.status, 'submitted', req.user.id, null);
  });
  audit(req.user.id, 'week.submit', 'node', c.id, { week: W, revision });
  return { ok: true, revision };
}));

r.post('/report/:cid/:week/:action(approve|reopen)', h((req) => {
  const { c, W } = load(req);
  const eng = new Engine();
  const to = act('week', req.user, c.id, W, req.params.action, req.body?.comment, () => {
    if (monthLocked(c.id, W)) throw bad('Month already closed for this week');
  }, eng.weekStatus(c.id, W));
  return { ok: true, status: to };
}));

r.get('/report/:cid/:week/history', h((req) => {
  const { c, W } = load(req);
  if (!canView(req.user, c.id)) throw forbidden();
  const eng = new Engine();
  const rows = plainAll(db.prepare(`SELECT f.revision, f.filed_at, f.data_json, u.name AS filed_by FROM filings f
    LEFT JOIN users u ON u.id = f.filed_by WHERE f.company_id = ? AND f.week_key = ? ORDER BY f.revision`).all(c.id, W));
  return {
    items: eng.items(c.id).map((i) => ({ key: i, label: eng.itemLabel(i) })),
    filings: rows.map((f) => {
      const d = JSON.parse(f.data_json);
      const tot = {};
      for (const [i, byM] of Object.entries(d.values || {})) tot[i] = Object.values(byM).reduce((a, v) => a + v, 0);
      return { revision: f.revision, filed_at: f.filed_at, filed_by: f.filed_by, totals: tot, adj: d.adj };
    }),
    log: history('week', c.id, W),
  };
}));

export default r;
