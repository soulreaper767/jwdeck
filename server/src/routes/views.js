import { Router } from 'express';
import { db } from '../db.js';
import { canView, scopeRoot } from '../auth.js';
import { Engine, companiesUnder, pathOf } from '../engine.js';
import * as P from '../periods.js';
import { h, forbidden, notFound } from './util.js';

const r = Router();

function ctx(req) {
  const eng = new Engine();
  const nodeId = Number(req.query.node) || scopeRoot(req.user) || eng.tree.roots[0]?.id;
  if (!eng.tree.byId.get(nodeId)) throw notFound('Node not found');
  if (!canView(req.user, nodeId, eng.tree)) throw forbidden();
  const W = P.isWeek(req.query.week) ? req.query.week : P.lastClosedWeek();
  return { eng, nodeId, W };
}

r.get('/periods', h(() => {
  const cur = P.weekKey();
  const weeks = P.weekRange(P.shiftWeek(cur, -60), cur).reverse().map((w) => ({ key: w, label: P.weekLabel(w), segments: P.segments(w) }));
  const curM = P.monthOfDate(new Date());
  const months = [];
  for (let i = 0; i < 24; i++) { const m = P.shiftMonth(curM, -i); months.push({ key: m, label: P.monthLabel(m) }); }
  return { current_week: cur, last_closed: P.lastClosedWeek(), weeks, months, current_month: curM };
}));

r.get('/view/week', h((req) => {
  const { eng, nodeId, W } = ctx(req);
  const v = eng.weekView(nodeId, W, req.query.month);
  return { ...v, path: pathOf(eng.tree, nodeId), group_currency: eng.groupCcy, fx_missing: [...eng.fxMissing] };
}));

r.get('/view/month', h((req) => {
  const { eng, nodeId } = ctx(req);
  const M = P.isMonth(req.query.month) ? req.query.month : P.monthOfDate(new Date());
  const v = eng.monthView(nodeId, M, P.lastClosedWeek());
  return { ...v, path: pathOf(eng.tree, nodeId), fx_missing: [...eng.fxMissing] };
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

function cellStatus(eng, cid, w) {
  const setup = eng.setup.get(cid);
  if (!setup || w < setup.start_week) return 'na';
  const rep = db.prepare('SELECT status FROM reports WHERE company_id = ? AND week_key = ?').get(cid, w);
  if (rep?.status === 'reopened') return 'reopened';
  if (eng.filings.has(`${cid}|${w}`)) return 'filed';
  return rep ? 'draft' : 'missing';
}

r.get('/view/status', h((req) => {
  const { eng, nodeId, W } = ctx(req);
  const n = Math.min(Number(req.query.n) || 8, 26);
  const weeks = P.weekRange(P.shiftWeek(W, -(n - 1)), W);
  const now = Date.now();
  const rows = companiesUnder(eng.tree, nodeId).map((c) => ({
    id: c.id, name: c.name, cluster: pathOf(eng.tree, c.id).slice(1, -1).map((p) => p.name).join(' / '),
    setup: !!eng.setup.get(c.id),
    cells: weeks.map((w) => {
      const s = cellStatus(eng, c.id, w);
      return { week: w, status: s, overdue: (s === 'missing' || s === 'draft') && now > P.dueDate(w, eng.settings.week_due_days).getTime() };
    }),
  }));
  return {
    weeks: weeks.map((w) => ({ key: w, label: P.weekLabel(w), due: P.ymd(P.dueDate(w, eng.settings.week_due_days)) })),
    rows,
  };
}));

r.get('/view/adjustments', h((req) => {
  const { eng, nodeId } = ctx(req);
  const out = [];
  for (const c of companiesUnder(eng.tree, nodeId)) {
    for (const [k, f] of eng.filings) {
      if (!k.startsWith(`${c.id}|`)) continue;
      for (const [item, a] of Object.entries(f.adj || {})) out.push({ company: c.name, week: k.split('|')[1], item: eng.itemLabel(item), value: a.value, reason: a.reason, currency: c.currency });
    }
  }
  return out.sort((a, b) => (a.week < b.week ? 1 : -1));
}));

export default r;


