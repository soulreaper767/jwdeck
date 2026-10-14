import { Router } from 'express';
import { db, plainAll } from '../db.js';
import { canView, scopeRoots, canPrepare, actions } from '../auth.js';
import { Engine, companiesUnder, pathOf } from '../engine.js';
import * as P from '../periods.js';
import { h, forbidden, notFound } from './util.js';

const r = Router();
const DAY = 86400000;

function ctx(req) {
  const eng = new Engine();
  const nodeId = Number(req.query.node) || scopeRoots(req.user, eng.tree)[0];
  if (!eng.tree.byId.get(nodeId)) throw notFound('Node not found');
  if (!canView(req.user, nodeId, eng.tree)) throw forbidden();
  const W = P.isWeek(req.query.week) ? req.query.week : P.lastClosedWeek();
  return { eng, nodeId, W };
}

r.get('/periods', h(() => {
  const cur = P.weekKey();
  const weeks = P.weekRange(P.shiftWeek(cur, -70), cur).reverse().map((w) => ({ key: w, label: P.weekLabel(w), segments: P.segments(w) }));
  const curM = P.monthOfDate(new Date());
  const months = [];
  for (let i = 0; i < 24; i++) { const m = P.shiftMonth(curM, -i); months.push({ key: m, label: P.monthLabel(m) }); }
  return { current_week: cur, last_closed: P.lastClosedWeek(), weeks, months, current_month: curM, last_month: P.shiftMonth(curM, -1) };
}));

r.get('/view/week', h((req) => {
  const { eng, nodeId, W } = ctx(req);
  return { ...eng.weekView(nodeId, W, req.query.month), path: pathOf(eng.tree, nodeId) };
}));

r.get('/view/month', h((req) => {
  const { eng, nodeId } = ctx(req);
  const M = P.isMonth(req.query.month) ? req.query.month : P.shiftMonth(P.monthOfDate(new Date()), -1);
  return { ...eng.monthView(nodeId, M, P.lastClosedWeek()), path: pathOf(eng.tree, nodeId) };
}));

r.get('/view/trend', h((req) => {
  const { eng, nodeId, W } = ctx(req);
  const n = Math.min(Math.max(Number(req.query.n) || 13, 4), 52);
  const codes = String(req.query.codes || '').split(',').filter(Boolean);
  const points = P.weekRange(P.shiftWeek(W, -(n - 1)), W).map((w) => {
    const v = eng.weekView(nodeId, w, null, { children: false });
    const row = { week: w, label: w.slice(5) };
    for (const s of v.sections) for (const x of s.rows) {
      if (!x.code || (codes.length && !codes.includes(x.code))) continue;
      row[x.code] = x.wk.a;
      row[`${x.code}_T`] = x.wk.t;
    }
    return row;
  });
  return { points };
}));

// Month-by-month key results (actual and budget) for charts
r.get('/view/month-trend', h((req) => {
  const { eng, nodeId } = ctx(req);
  const n = Math.min(Math.max(Number(req.query.n) || 6, 2), 12);
  const last = P.shiftMonth(P.monthOfDate(new Date()), -1);
  const codes = String(req.query.codes || 'PL_REV,PL_GP,PL_EBITDA,PL_NP,CF_CLOSE,REV_NET').split(',');
  const upto = P.lastClosedWeek();
  const points = [];
  for (let i = n - 1; i >= 0; i--) {
    const M = P.shiftMonth(last, -i);
    const v = eng.monthView(nodeId, M, upto, { children: false });
    const row = { month: M, label: P.monthLabel(M).slice(0, 3) };
    for (const sec of v.sections) for (const x of sec.rows) if (codes.includes(x.code)) { row[x.code] = x.m.a; row[`${x.code}_B`] = x.m.b; }
    points.push(row);
  }
  return { points };
}));

// Workflow status grid: companies × weeks or months
r.get('/view/status', h((req) => {
  const { eng, nodeId, W } = ctx(req);
  const kind = req.query.kind === 'month' ? 'month' : 'week';
  const now = Date.now();
  let periods;
  if (kind === 'week') {
    periods = P.weekRange(P.shiftWeek(W, -7), W).map((w) => ({ key: w, label: w.slice(5), sub: P.weekLabel(w).split(' · ')[1], due: P.dueDate(w, eng.settings.week_due_days).getTime() }));
  } else {
    const cur = P.monthOfDate(new Date());
    periods = [];
    for (let i = 6; i >= 0; i--) {
      const m = P.shiftMonth(cur, -i);
      periods.push({ key: m, label: P.monthLabel(m), due: P.monthEnd(m).getTime() + Number(eng.settings.month_due_days || 10) * DAY });
    }
  }
  const done = new Set(['submitted', 'company_ok', 'cluster_ok', 'approved']);
  const rows = companiesUnder(eng.tree, nodeId).map((c) => ({
    id: c.id, name: c.name, cluster: pathOf(eng.tree, c.id).slice(1, -1).map((p) => p.name).join(' / '),
    cells: periods.map((p) => {
      const s = kind === 'week' ? eng.weekStatus(c.id, p.key) : eng.monthStatus(c.id, p.key);
      const reopened = (kind === 'week' ? eng.wreopen : eng.mreopen).get(`${c.id}|${p.key}`) || 0;
      return { key: p.key, status: s, reopened, ready: kind === 'month' ? eng.monthReady(c.id, p.key) : true, overdue: !['na', 'lapsed'].includes(s) && !done.has(s) && now > p.due };
    }),
  }));
  return { kind, periods: periods.map(({ due, ...p }) => ({ ...p, due: P.ymd(new Date(due)) })), rows };
}));

// What needs my attention
r.get('/inbox', h((req) => {
  const eng = new Engine();
  const u = req.user;
  const review = [];
  const todo = [];
  const name = (cid) => eng.tree.byId.get(cid)?.name;
  for (const [table, kind, key] of [['reports', 'week', 'week_key'], ['month_reports', 'month', 'month_key']]) {
    for (const rep of plainAll(db.prepare(`SELECT * FROM ${table} WHERE status IN ('submitted','company_ok','cluster_ok','reopened','draft') ORDER BY ${key}`).all())) {
      if (!canView(u, rep.company_id, eng.tree)) continue;
      const item = { kind, company_id: rep.company_id, company: name(rep.company_id), period: rep[key], status: rep.status, updated_at: rep.updated_at };
      if (actions(u, rep.company_id, rep.status, eng.tree).includes('approve')) review.push(item);
      else if (['reopened', 'draft'].includes(rep.status) && canPrepare(u, rep.company_id, eng.tree)) {
        const st = kind === 'week' ? eng.weekStatus(rep.company_id, rep.week_key) : rep.status;
        if (st !== 'lapsed') todo.push({ ...item, status: st });
      }
    }
  }
  if (u.role === 'company_dpo' || u.role === 'admin') {
    const last = P.lastClosedWeek();
    const lm = P.shiftMonth(P.monthOfDate(new Date()), -1);
    for (const root of scopeRoots(u, eng.tree)) {
      for (const c of companiesUnder(eng.tree, root)) {
        if (!canPrepare(u, c.id, eng.tree)) continue;
        if (!eng.setup.get(c.id)) { todo.push({ kind: 'setup', company_id: c.id, company: c.name, period: '', status: 'new' }); continue; }
        for (const w of P.weekRange(P.shiftWeek(last, -3), P.weekKey())) if (eng.weekStatus(c.id, w) === 'new' && P.weekStart(w) <= new Date()) todo.push({ kind: 'week', company_id: c.id, company: c.name, period: w, status: 'new' });
        if (eng.monthStatus(c.id, lm) === 'new' && eng.monthReady(c.id, lm)) todo.push({ kind: 'month', company_id: c.id, company: c.name, period: lm, status: 'new' });
      }
    }
  }
  return { review, todo };
}));

export default r;
