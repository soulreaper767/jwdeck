import { Router } from 'express';
import { db, plainAll } from '../db.js';
import { canView, scopeRoot } from '../auth.js';
import { Ctx, headOut, comparativeKeys, filingStatus, pathOf, feedingInputHeads, companiesUnder } from '../consol.js';
import * as P from '../periods.js';
import { h, bad, forbidden, notFound } from './util.js';

const r = Router();

function params(req, ctx) {
  const freq = req.query.freq === 'weekly' ? 'weekly' : 'monthly';
  let nodeId = Number(req.query.node) || scopeRoot(req.user) || ctx.tree.roots[0]?.id;
  if (!ctx.tree.byId.get(nodeId)) throw notFound('Node not found');
  if (!canView(req.user, nodeId, ctx.tree)) throw forbidden();
  const key = req.query.key && P.isValidKey(freq, req.query.key) ? req.query.key : P.lastClosed(freq);
  const allowed = freq === 'monthly' ? ['period', 'qtd', 'ytd'] : ['period', 'mtd'];
  const mode = allowed.includes(req.query.mode) ? req.query.mode : 'period';
  return { freq, nodeId, key, mode };
}

const toObj = (m) => Object.fromEntries([...m].map(([k, v]) => [k, v == null ? null : Math.round(v * 100) / 100]));

function rangeLabel(freq, keys, mode, fyStart) {
  if (!keys) return null;
  if (keys.length === 1) return P.label(freq, keys[0]);
  if (mode === 'ytd') return `${P.fiscalYearLabel(keys[0], fyStart)} YTD to ${P.label(freq, keys[keys.length - 1])}`;
  const first = freq === 'weekly' ? keys[0] : P.label(freq, keys[0]);
  const last = freq === 'weekly' ? keys[keys.length - 1] : P.label(freq, keys[keys.length - 1]);
  return `${first} – ${last}`;
}

const headVisible = (hd, freq) => hd.frequency === 'both' || hd.frequency === freq;

// Consolidated statement for a node with comparatives and a breakdown by direct children.
r.get('/consol/report', h((req) => {
  const ctx = new Ctx();
  const { freq, nodeId, key, mode } = params(req, ctx);
  const node = ctx.tree.byId.get(nodeId);
  const k = comparativeKeys(freq, key, mode, ctx.fyStart);

  // Like-for-like (default): comparatives only include companies that have filed the current period,
  // so a late filer does not show up as a fake drop.
  const lfl = req.query.lfl !== '0';
  const only = lfl ? ctx.filers(nodeId, freq, k.cur) : null;
  const cur = ctx.consolidate(nodeId, freq, k.cur);
  const prev = k.prev ? ctx.consolidate(nodeId, freq, k.prev, only) : null;
  const ly = ctx.consolidate(nodeId, freq, k.ly, only);

  const children = node.children.filter((c) => c.active && (c.type === 'company' || companiesUnder(ctx.tree, c.id).length));
  const byChild = {};
  for (const c of children) {
    const res = ctx.consolidate(c.id, freq, k.cur);
    byChild[c.id] = {
      cur: toObj(res.values),
      prev: k.prev ? toObj(ctx.consolidate(c.id, freq, k.prev, only).values) : null,
      ly: toObj(ctx.consolidate(c.id, freq, k.ly, only).values),
      coverage: res.coverage,
    };
  }

  return {
    node: { id: node.id, name: node.name, type: node.type, code: node.code, currency: node.currency },
    path: pathOf(ctx.tree, nodeId),
    frequency: freq, key, mode, lfl,
    group_currency: ctx.groupCcy,
    labels: { cur: rangeLabel(freq, k.cur, mode, ctx.fyStart), prev: rangeLabel(freq, k.prev, mode, ctx.fyStart), ly: rangeLabel(freq, k.ly, mode, ctx.fyStart) },
    heads: ctx.heads.ordered.filter((hd) => headVisible(hd, freq)).map(headOut),
    cur: toObj(cur.values), prev: prev ? toObj(prev.values) : null, ly: toObj(ly.values),
    coverage: { cur: cur.coverage, prev: prev?.coverage || null, ly: ly.coverage },
    children: children.map((c) => ({ id: c.id, name: c.name, code: c.code, type: c.type })),
    by_child: byChild,
    fx_missing: [...ctx.fxMissing],
  };
}));

// Trend of selected heads over the last n periods.
r.get('/consol/trend', h((req) => {
  const ctx = new Ctx();
  const { freq, nodeId, key } = params(req, ctx);
  const n = Math.min(Math.max(Number(req.query.n) || 12, 2), 53);
  const codes = String(req.query.heads || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  const heads = (codes.length ? codes.map((c) => ctx.heads.byCode.get(c)).filter(Boolean)
    : ctx.heads.ordered.filter((x) => x.is_kpi && headVisible(x, freq)));
  const points = P.series(freq, key, n).map((k) => {
    const { values, coverage } = ctx.consolidate(nodeId, freq, [k]);
    const lyv = ctx.consolidate(nodeId, freq, [P.lastYear(freq, k)]).values;
    const row = { key: k, label: freq === 'monthly' ? P.label(freq, k) : k, coverage };
    for (const hd of heads) {
      row[hd.code] = values.get(hd.id) == null ? null : Math.round(values.get(hd.id));
      row[`${hd.code}_LY`] = lyv.get(hd.id) == null ? null : Math.round(lyv.get(hd.id));
    }
    return row;
  });
  return { heads: heads.map(headOut), points };
}));

// A company's figures in its OWN reporting format, with lines feeding a given head highlighted.
r.get('/consol/company', h((req) => {
  const ctx = new Ctx();
  const { freq, key, mode } = params(req, ctx);
  const companyId = Number(req.query.company);
  const company = ctx.tree.byId.get(companyId);
  if (!company || company.type !== 'company') throw notFound('Company not found');
  if (!canView(req.user, companyId, ctx.tree)) throw forbidden();
  const k = comparativeKeys(freq, key, mode, ctx.fyStart);

  // Line layout: from the most recent filing in the current range (falls back to older ones)
  const layoutFiling = [...k.cur].reverse().map((x) => ctx.filing(companyId, freq, x)).find(Boolean)
    || [...(k.prev || []), ...k.ly].reverse().map((x) => ctx.filing(companyId, freq, x)).find(Boolean);
  const lines = layoutFiling ? layoutFiling.lines.map(({ value, note, ...l }) => l) : [];

  const natureOf = (l) => (l.head_id && ctx.heads.byId.get(l.head_id)?.nature) || 'flow';
  const agg = (keys) => {
    if (!keys) return null;
    const out = {};
    const filed = keys.map((x) => ctx.filing(companyId, freq, x)).filter(Boolean);
    if (!filed.length) return null;
    for (const l of lines) {
      const vals = filed.map((f) => (f.lines.find((x) => x.id === l.id) || f.lines.find((x) => x.code === l.code))?.value)
        .filter((v) => v != null);
      if (!vals.length) { out[l.id] = null; continue; }
      const nat = natureOf(l);
      out[l.id] = nat === 'balance' ? vals[vals.length - 1] : nat === 'average' ? vals.reduce((a, b) => a + b, 0) / vals.length : vals.reduce((a, b) => a + b, 0);
    }
    return out;
  };

  const headId = Number(req.query.head) || null;
  const feeding = headId ? feedingInputHeads(ctx.heads, headId) : new Set();
  const notes = {};
  for (const x of k.cur) for (const l of ctx.filing(companyId, freq, x)?.lines || []) if (l.note) (notes[l.id] ||= []).push(`${x}: ${l.note}`);

  return {
    company: { id: company.id, name: company.name, code: company.code, currency: company.currency },
    path: pathOf(ctx.tree, companyId), frequency: freq, key, mode,
    labels: { cur: rangeLabel(freq, k.cur, mode, ctx.fyStart), prev: rangeLabel(freq, k.prev, mode, ctx.fyStart), ly: rangeLabel(freq, k.ly, mode, ctx.fyStart) },
    lines: lines.map((l) => ({
      ...l, head_code: l.head_id ? ctx.heads.byId.get(l.head_id)?.code : null,
      head_name: l.head_id ? ctx.heads.byId.get(l.head_id)?.name : null, highlight: l.head_id ? feeding.has(l.head_id) : false,
      fmt: (l.head_id && ctx.heads.byId.get(l.head_id)?.fmt) || 'amount',
      hib: l.head_id ? ctx.heads.byId.get(l.head_id)?.higher_is_better ?? 1 : 1,
    })),
    cur: agg(k.cur), prev: agg(k.prev), ly: agg(k.ly), notes,
    filings: k.cur.map((x) => { const f = ctx.filing(companyId, freq, x); return { key: x, revision: f?.revision || null, filed_at: f?.filed_at || null }; }),
  };
}));

// Filing status of every company under a node for one period
r.get('/consol/status', h((req) => {
  const ctx = new Ctx();
  const { freq, nodeId, key } = params(req, ctx);
  const rows = filingStatus(ctx, nodeId, freq, key).map((x) => ({ ...x, path: pathOf(ctx.tree, x.company_id).slice(1, -1).map((p) => p.name).join(' › ') }));
  const due = P.dueDate(freq, key, ctx.settings[`${freq}_due_days`]);
  return {
    period: P.describe(freq, key), due: due.toISOString().slice(0, 10), rows,
    summary: {
      total: rows.length, filed: rows.filter((x) => x.status === 'filed').length,
      draft: rows.filter((x) => x.status === 'draft').length, reopened: rows.filter((x) => x.status === 'reopened').length,
      missing: rows.filter((x) => x.status === 'missing').length, overdue: rows.filter((x) => x.overdue).length,
    },
  };
}));

// Companies x periods status grid
r.get('/consol/status-matrix', h((req) => {
  const ctx = new Ctx();
  const { freq, nodeId, key } = params(req, ctx);
  const n = Math.min(Math.max(Number(req.query.n) || 6, 1), 26);
  const keys = P.series(freq, key, n);
  const companies = companiesUnder(ctx.tree, nodeId);
  const subs = plainAll(db.prepare(`SELECT company_id, period_key, status FROM submissions WHERE frequency = ? AND period_key IN (${keys.map(() => '?').join(',')})`)
    .all(freq, ...keys));
  const subMap = new Map(subs.map((s) => [`${s.company_id}|${s.period_key}`, s.status]));
  const now = new Date();
  return {
    periods: keys.map((x) => ({ key: x, label: freq === 'monthly' ? P.label(freq, x) : x })),
    rows: companies.map((c) => ({
      id: c.id, code: c.code, name: c.name,
      path: pathOf(ctx.tree, c.id).slice(1, -1).map((p) => p.name).join(' › '),
      cells: keys.map((x) => {
        const s = subMap.get(`${c.id}|${x}`);
        const f = ctx.filing(c.id, freq, x);
        const status = s === 'reopened' ? 'reopened' : f ? 'filed' : s ? 'draft' : 'missing';
        return { key: x, status, overdue: !f && now > P.dueDate(freq, x, ctx.settings[`${freq}_due_days`]) };
      }),
    })),
  };
}));

// Period helper for pickers
r.get('/periods', h((req) => {
  const freq = req.query.freq === 'weekly' ? 'weekly' : 'monthly';
  const n = Math.min(Number(req.query.n) || (freq === 'weekly' ? 60 : 36), 160);
  const end = P.keyForDate(freq);
  return { current: end, last_closed: P.lastClosed(freq), list: P.series(freq, end, n).reverse().map((k) => P.describe(freq, k)) };
}));

export default r;
