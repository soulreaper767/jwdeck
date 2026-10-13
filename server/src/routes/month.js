import { Router } from 'express';
import { db, tx, audit, plain, plainAll } from '../db.js';
import { canView, canPrepare, actions } from '../auth.js';
import { Engine, pathOf } from '../engine.js';
import { LOCKED, act, log, history } from '../workflow.js';
import * as P from '../periods.js';
import { h, bad, forbidden, notFound, num } from './util.js';

const r = Router();

function load(req) {
  const { cid, month } = req.params;
  if (!P.isMonth(month)) throw bad('Invalid month');
  const c = db.prepare("SELECT * FROM nodes WHERE id = ? AND type = 'company'").get(Number(cid));
  if (!c) throw notFound('Company not found');
  return { c: { ...c }, M: month };
}
const getRep = (cid, M) => plain(db.prepare('SELECT * FROM month_reports WHERE company_id = ? AND month_key = ?').get(cid, M));

function draft(rep) {
  const d = { values: {}, remarks: rep?.remarks || '' };
  if (rep) for (const v of plainAll(db.prepare('SELECT * FROM month_values WHERE report_id = ?').all(rep.id))) if (v.value != null) d.values[v.item] = v.value;
  return d;
}
function clean(eng, body) {
  const allowed = new Set(eng.monthInputs);
  const d = { values: {}, remarks: body?.remarks != null ? String(body.remarks).slice(0, 2000) : '' };
  for (const [k, v] of Object.entries(body?.values || {})) if (allowed.has(k) && num(v) != null) d.values[k] = num(v);
  return d;
}
const preview = (eng, c, M, d) => {
  if (d) eng.setMonthDraft(c.id, M, d);
  return eng.monthView(c.id, M, P.lastClosedWeek(), { children: false });
};

r.get('/month/:cid/:month', h((req) => {
  const { c, M } = load(req);
  if (!canView(req.user, c.id)) throw forbidden();
  const eng = new Engine();
  const setup = eng.setup.get(c.id);
  const rep = getRep(c.id, M);
  const status = rep?.status || 'new';
  const locked = LOCKED.has(status);
  const f = eng.mfilings.get(`${c.id}|${M}`);
  const d = locked && f ? { values: f.values, remarks: f.remarks || '' } : draft(rep);
  const ready = eng.monthReady(c.id, M);
  const weeks = setup ? P.monthWeeks(M).filter((w) => w >= setup.start_week).map((w) => ({
    key: w, portion: P.segments(w).find((s) => s.month === M).label, status: eng.weekStatus(c.id, w), reopened: eng.wreopen.get(`${c.id}|${w}`) || 0,
  })) : [];
  const due = new Date(P.monthEnd(M).getTime() + Number(eng.settings.month_due_days || 10) * 86400000);
  return {
    company: { ...c, meta: JSON.parse(c.meta || '{}') }, path: pathOf(eng.tree, c.id),
    month: M, month_label: P.monthLabel(M), due: P.ymd(due),
    status, reopened: rep?.reopened || 0, revision: rep?.revision || 0, needs_setup: !setup,
    weeks, ready,
    editable: !!setup && canPrepare(req.user, c.id, eng.tree) && !locked && !!c.active,
    actions: actions(req.user, c.id, status, eng.tree),
    log: history('month', c.id, M),
    inputs: eng.monthInputs,
    data: d,
    preview: setup ? preview(eng, c, M, locked ? null : d) : null,
  };
}));

r.post('/month/:cid/:month/preview', h((req) => {
  const { c, M } = load(req);
  if (!canView(req.user, c.id)) throw forbidden();
  const eng = new Engine();
  return preview(eng, c, M, clean(eng, req.body));
}));

function save(req, c, M, d) {
  if (!canPrepare(req.user, c.id)) throw forbidden();
  let rep = getRep(c.id, M);
  if (rep && LOCKED.has(rep.status)) throw bad('Submitted and locked');
  return tx(() => {
    if (!rep) {
      const info = db.prepare("INSERT INTO month_reports(company_id, month_key, status, updated_by) VALUES (?,?,'draft',?)").run(c.id, M, req.user.id);
      rep = plain(db.prepare('SELECT * FROM month_reports WHERE id = ?').get(info.lastInsertRowid));
    }
    db.prepare('DELETE FROM month_values WHERE report_id = ?').run(rep.id);
    const ins = db.prepare('INSERT INTO month_values(report_id, item, value) VALUES (?,?,?)');
    for (const [k, v] of Object.entries(d.values)) ins.run(rep.id, k, v);
    db.prepare("UPDATE month_reports SET remarks = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?").run(d.remarks, req.user.id, rep.id);
    return plain(db.prepare('SELECT * FROM month_reports WHERE id = ?').get(rep.id));
  });
}

r.put('/month/:cid/:month', h((req) => {
  const { c, M } = load(req);
  save(req, c, M, clean(new Engine(), req.body));
  return { ok: true };
}));

r.post('/month/:cid/:month/submit', h((req) => {
  const { c, M } = load(req);
  const eng = new Engine();
  const d = clean(eng, req.body);
  if (!eng.monthReady(c.id, M)) throw bad('All weeks of the month must be submitted first');
  if (!Object.keys(d.values).length) throw bad('No figures entered');
  const rep = save(req, c, M, d);
  const revision = (db.prepare('SELECT MAX(revision) r FROM month_filings WHERE company_id = ? AND month_key = ?').get(c.id, M).r || 0) + 1;
  tx(() => {
    db.prepare('INSERT INTO month_filings(report_id, company_id, month_key, revision, data_json, filed_by) VALUES (?,?,?,?,?,?)')
      .run(rep.id, c.id, M, revision, JSON.stringify(d), req.user.id);
    db.prepare("UPDATE month_reports SET status = 'submitted', revision = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?").run(revision, req.user.id, rep.id);
    log('month', c.id, M, 'submit', rep.status, 'submitted', req.user.id, null);
  });
  audit(req.user.id, 'month.submit', 'node', c.id, { month: M, revision });
  return { ok: true, revision };
}));

r.post('/month/:cid/:month/:action(approve|reopen)', h((req) => {
  const { c, M } = load(req);
  return { ok: true, status: act('month', req.user, c.id, M, req.params.action, req.body?.comment) };
}));

export default r;
