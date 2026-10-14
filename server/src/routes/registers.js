// Pipeline (opportunities) and strategic initiatives registers, plus auto-fill of the weekly
// Business Development figures from them.
import { Router } from 'express';
import crypto from 'node:crypto';
import { db, audit, plainAll } from '../db.js';
import { canView, canPrepare } from '../auth.js';
import { loadTree, companiesUnder } from '../engine.js';
import * as P from '../periods.js';
import { h, bad, forbidden, notFound, num } from './util.js';

const r = Router();
const now = () => new Date().toISOString();
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
const STAGES = ['lead', 'proposal', 'negotiation', 'awaiting', 'won', 'lost'];
const STATUSES = ['planned', 'in_progress', 'done', 'dropped'];

function company(id) {
  const c = db.prepare("SELECT * FROM nodes WHERE id = ? AND type = 'company'").get(Number(id));
  if (!c) throw notFound('Company not found');
  return { ...c };
}

// ---------------------------------------------------------------- opportunities
r.get('/opps/:cid', h((req) => {
  const c = company(req.params.cid);
  if (!canView(req.user, c.id)) throw forbidden();
  const rows = plainAll(db.prepare('SELECT * FROM opportunities WHERE company_id = ? AND deleted = 0 ORDER BY created_on DESC, id DESC').all(c.id));
  return { company: c, rows, editable: canPrepare(req.user, c.id), stages: STAGES };
}));

r.put('/opps/:cid/:uid', h((req) => {
  const c = company(req.params.cid);
  if (!canPrepare(req.user, c.id)) throw forbidden();
  const b = req.body || {};
  const uid = req.params.uid === 'new' ? crypto.randomUUID() : req.params.uid;
  if (!String(b.customer || '').trim()) throw bad('Customer is required');
  if (!isDate(b.created_on)) throw bad('Date opened is required');
  const stage = STAGES.includes(b.stage) ? b.stage : 'lead';
  const closed = stage === 'won' || stage === 'lost' ? (isDate(b.closed_on) ? b.closed_on : P.ymd(new Date())) : null;
  db.prepare(`INSERT INTO opportunities(uid, company_id, customer, title, value, stage, probability, created_on, expected_close, closed_on, owner, notes, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(uid) DO UPDATE SET customer=excluded.customer, title=excluded.title, value=excluded.value, stage=excluded.stage, probability=excluded.probability,
      created_on=excluded.created_on, expected_close=excluded.expected_close, closed_on=excluded.closed_on, owner=excluded.owner, notes=excluded.notes,
      updated_at=excluded.updated_at, deleted=0`)
    .run(uid, c.id, String(b.customer).trim(), b.title || null, num(b.value) || 0, stage, num(b.probability), b.created_on,
      isDate(b.expected_close) ? b.expected_close : null, closed, b.owner || null, b.notes || null, now());
  audit(req.user.id, 'opp.save', 'node', c.id, { uid, stage });
  return { uid };
}));

r.delete('/opps/:cid/:uid', h((req) => {
  const c = company(req.params.cid);
  if (!canPrepare(req.user, c.id)) throw forbidden();
  db.prepare('UPDATE opportunities SET deleted = 1, updated_at = ? WHERE uid = ? AND company_id = ?').run(now(), req.params.uid, c.id);
  return { ok: true };
}));

// ---------------------------------------------------------------- initiatives
r.get('/inits/:cid', h((req) => {
  const c = company(req.params.cid);
  if (!canView(req.user, c.id)) throw forbidden();
  const rows = plainAll(db.prepare('SELECT * FROM initiatives WHERE company_id = ? AND deleted = 0 ORDER BY start_date DESC, id DESC').all(c.id));
  return { company: c, rows, editable: canPrepare(req.user, c.id), statuses: STATUSES };
}));

r.put('/inits/:cid/:uid', h((req) => {
  const c = company(req.params.cid);
  if (!canPrepare(req.user, c.id)) throw forbidden();
  const b = req.body || {};
  const uid = req.params.uid === 'new' ? crypto.randomUUID() : req.params.uid;
  if (!String(b.title || '').trim()) throw bad('Title is required');
  if (!isDate(b.start_date)) throw bad('Start date is required');
  const status = STATUSES.includes(b.status) ? b.status : 'planned';
  db.prepare(`INSERT INTO initiatives(uid, company_id, title, owner, start_date, target_date, status, progress, notes, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(uid) DO UPDATE SET title=excluded.title, owner=excluded.owner, start_date=excluded.start_date, target_date=excluded.target_date,
      status=excluded.status, progress=excluded.progress, notes=excluded.notes, updated_at=excluded.updated_at, deleted=0`)
    .run(uid, c.id, String(b.title).trim(), b.owner || null, b.start_date, isDate(b.target_date) ? b.target_date : null, status,
      Math.max(0, Math.min(100, num(b.progress) || (status === 'done' ? 100 : 0))), b.notes || null, now());
  audit(req.user.id, 'initiative.save', 'node', c.id, { uid, status });
  return { uid };
}));

r.delete('/inits/:cid/:uid', h((req) => {
  const c = company(req.params.cid);
  if (!canPrepare(req.user, c.id)) throw forbidden();
  db.prepare('UPDATE initiatives SET deleted = 1, updated_at = ? WHERE uid = ? AND company_id = ?').run(now(), req.params.uid, c.id);
  return { ok: true };
}));

// ---------------------------------------------------------------- consolidated (cluster / group), read-only
r.get('/registers/:kind(opps|inits)/node/:id', h((req) => {
  const tree = loadTree();
  const node = tree.byId.get(Number(req.params.id));
  if (!node) throw notFound();
  if (!canView(req.user, node.id, tree)) throw forbidden();
  const companies = companiesUnder(tree, node.id);
  const ids = companies.map((c) => c.id);
  if (!ids.length) return { node: { id: node.id, name: node.name, type: node.type }, rows: [], companies: [] };
  const table = req.params.kind === 'opps' ? 'opportunities' : 'initiatives';
  const order = req.params.kind === 'opps' ? 'created_on DESC' : 'start_date DESC';
  const name = new Map(companies.map((c) => [c.id, c.name]));
  const rows = plainAll(db.prepare(`SELECT * FROM ${table} WHERE deleted = 0 AND company_id IN (${ids.map(() => '?').join(',')}) ORDER BY ${order}, id DESC`).all(...ids))
    .map((x) => ({ ...x, company: name.get(x.company_id) }));
  return { node: { id: node.id, name: node.name, type: node.type, meta: node.meta }, rows, companies: companies.map((c) => ({ id: c.id, name: c.name })), stages: STAGES, statuses: STATUSES };
}));

// ---------------------------------------------------------------- weekly figures from the registers
export function bdFromRegisters(cid, W) {
  const s = P.ymd(P.weekStart(W));
  const e = P.ymd(P.weekEnd(W));
  const opps = plainAll(db.prepare('SELECT * FROM opportunities WHERE company_id = ? AND deleted = 0').all(cid));
  const inits = plainAll(db.prepare('SELECT * FROM initiatives WHERE company_id = ? AND deleted = 0').all(cid));
  const newOpps = opps.filter((o) => o.created_on >= s && o.created_on <= e);
  // open at week end: opened by then and not yet won or lost by then
  const openAtEnd = opps.filter((o) => o.created_on <= e && (!o.closed_on || o.closed_on > e));
  const won = opps.filter((o) => o.stage === 'won' && o.closed_on >= s && o.closed_on <= e);
  const awaiting = openAtEnd.filter((o) => o.stage === 'awaiting');
  const newInits = inits.filter((i) => i.start_date >= s && i.start_date <= e);
  const sum = (l) => l.reduce((a, o) => a + (o.value || 0), 0);
  return {
    has: opps.length > 0 || inits.length > 0,
    values: {
      BD_LEADS: newOpps.length,
      BD_LEADS_V: sum(newOpps),
      BD_PIPE: sum(openAtEnd),
      BD_CONF: sum(won),
      BD_TBD: sum(awaiting),
      BD_INIT: newInits.length ? 1 : 0,
    },
    note: newInits.map((i) => i.title).join('; '),
  };
}

r.get('/report/:cid/:week/autofill', h((req) => {
  const c = company(req.params.cid);
  if (!canView(req.user, c.id)) throw forbidden();
  if (!P.isWeek(req.params.week)) throw bad('Invalid week');
  return bdFromRegisters(c.id, req.params.week);
}));

export default r;
