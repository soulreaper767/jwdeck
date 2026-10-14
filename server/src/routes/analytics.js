// Performance analytics: who and what performed best and worst, at any level, for week / MTD / YTD.
import { Router } from 'express';
import { canView, scopeRoots } from '../auth.js';
import { Engine, companiesUnder, pathOf } from '../engine.js';
import * as P from '../periods.js';
import { h, forbidden, notFound } from './util.js';

const r = Router();

const METRICS = [
  { code: 'REV_NET', name: 'Net revenue', hib: 1 },
  { code: 'REC_TOT', name: 'Recoveries', hib: 1 },
  { code: 'PAY_TOT', name: 'Payments', hib: 0 },
  { code: 'BD_CONF', name: 'Orders confirmed', hib: 1 },
  { code: 'ALL:PQ', name: 'Production (all units)', hib: 1 },
  { code: 'CB_CLOSE', name: 'Closing cash & bank', hib: 1 },
];
const MONTH_METRICS = [
  { code: 'PL_REV', name: 'Net revenue', hib: 1 },
  { code: 'PL_GP', name: 'Gross profit', hib: 1 },
  { code: 'PL_EBITDA', name: 'EBITDA', hib: 1 },
  { code: 'PL_NP', name: 'Net profit', hib: 1 },
];

const flat = (v) => Object.fromEntries(v.sections.flatMap((s) => s.rows).filter((x) => x.code).map((x) => [x.code, x]));
const pctOf = (a, t) => (a != null && t ? ((a - t) / Math.abs(t)) * 100 : null);
// score so that "better" is always higher
const score = (e, hib) => (e.pct == null ? null : hib ? e.pct : -e.pct);

function rank(units, rowsOf, metric, basis) {
  const list = units.map((u) => {
    const x = rowsOf(u.id)?.[metric.code];
    const p = basis === 'm' ? x?.m : x?.[basis];
    const a = basis === 'm' ? p?.a : p?.a;
    const t = basis === 'm' ? p?.b : p?.t;
    return { id: u.id, name: u.name, type: u.type, a: a ?? null, t: t ?? null, pct: pctOf(a, t) };
  }).filter((e) => e.a != null);
  return list.sort((x, y) => (score(y, metric.hib) ?? -Infinity) - (score(x, metric.hib) ?? -Infinity) || (y.a - x.a));
}

r.get('/view/analytics', h((req) => {
  const eng = new Engine();
  const nodeId = Number(req.query.node) || scopeRoots(req.user, eng.tree)[0];
  const node = eng.tree.byId.get(nodeId);
  if (!node) throw notFound('Node not found');
  if (!canView(req.user, nodeId, eng.tree)) throw forbidden();
  const W = P.isWeek(req.query.week) ? req.query.week : P.lastClosedWeek();
  const periodMode = ['month', 'quarter', 'year'].includes(req.query.mode) ? req.query.mode : null;
  const spec = periodMode ? eng.periodSpec(req.query) : null;
  const basis = periodMode ? 'p' : ['wk', 'mtd', 'ytd'].includes(req.query.basis) ? req.query.basis : 'mtd';
  const M = P.shiftMonth(P.monthOfDate(new Date()), -1);
  const pmemo = new Map();
  const pv = (id) => { if (!pmemo.has(id)) pmemo.set(id, flat(eng.periodView(id, spec, { children: false }))); return pmemo.get(id); };

  const memo = new Map();
  const wv = (id, w = W) => {
    const k = `${id}|${w}`;
    if (!memo.has(k)) memo.set(k, flat(eng.weekView(id, w, null, { children: false })));
    return memo.get(k);
  };
  const mmemo = new Map();
  const mv = (id) => { if (!mmemo.has(id)) mmemo.set(id, flat(eng.monthView(id, M, P.lastClosedWeek(), { children: false }))); return mmemo.get(id); };

  const companies = companiesUnder(eng.tree, nodeId).filter((c) => eng.setup.get(c.id));
  const units = node.type === 'company' ? [] : node.children.filter((c) => c.active && companiesUnder(eng.tree, c.id).length);
  const label = (c) => ({ id: c.id, name: c.name, type: c.type, cluster: pathOf(eng.tree, c.id).slice(1, -1).map((p) => p.name).join(' / ') });

  // ---- rankings
  const rankings = {
    units: units.length ? METRICS.map((m) => ({ ...m, list: rank(units, (id) => (spec ? pv(id) : wv(id)), m, basis) })) : [],
    companies: companies.length > 1 ? METRICS.map((m) => ({ ...m, list: rank(companies, (id) => (spec ? pv(id) : wv(id)), m, basis).map((e) => ({ ...e, ...label(eng.tree.byId.get(e.id)) })) })) : [],
    month: companies.length > 1 ? MONTH_METRICS.map((m) => ({ ...m, list: rank(companies, (id) => (spec ? pv(id) : mv(id)), m, spec ? 'p' : 'm').map((e) => ({ ...e, ...label(eng.tree.byId.get(e.id)) })) })) : [],
  };

  // ---- SKUs: sales value vs budget for every SKU under this node
  const skus = [];
  for (const c of companies) {
    const rows = (spec ? eng.periodView(c.id, spec, { children: false }) : eng.weekView(c.id, W, null, { children: false })).sections.find((s) => s.code === 'PRODSALES')?.rows || [];
    let group = null;
    for (const x of rows) {
      if (x.group) { group = x.name; continue; }
      if (!x.code?.endsWith(':SV')) continue;
      const p = x[basis];
      if (p?.a == null) continue;
      skus.push({ company: c.name, company_id: c.id, sku: group, a: p.a, t: p.t, pct: pctOf(p.a, p.t) });
    }
  }
  skus.sort((x, y) => (y.pct ?? -Infinity) - (x.pct ?? -Infinity));

  // ---- biggest movers: this week vs last week
  const prevW = P.shiftWeek(W, -1);
  const movers = [];
  for (const c of companies) {
    const now = spec ? pv(c.id) : wv(c.id);
    const before = spec ? null : wv(c.id, prevW);
    for (const m of [...METRICS, ...(spec ? MONTH_METRICS : [])]) {
      if (m.code === 'CB_CLOSE' && spec) continue;
      const a = spec ? now[m.code]?.p.a : now[m.code]?.wk.a;
      const b = spec ? now[m.code]?.c.a : before[m.code]?.wk.a;
      if (a == null || b == null || b === 0) continue;
      const ch = ((a - b) / Math.abs(b)) * 100;
      movers.push({ company: c.name, company_id: c.id, metric: m.name, code: m.code, hib: m.hib, now: a, before: b, pct: ch, good: m.hib ? ch >= 0 : ch <= 0 });
    }
  }
  movers.sort((x, y) => Math.abs(y.pct) - Math.abs(x.pct));

  // ---- streaks: consecutive weeks on / below net revenue budget
  const streaks = companies.map((c) => {
    let on = 0;
    let off = 0;
    const history = [];
    for (let i = 0; i < 13; i++) {
      const w = P.shiftWeek(W, -i);
      const x = wv(c.id, w).REV_NET?.wk;
      if (!x || x.a == null || !x.t) { history.push(null); continue; }
      history.push(x.a >= x.t ? 1 : 0);
    }
    for (const v of history) { if (v === 1 && !off) on++; else break; }
    if (!on) for (const v of history) { if (v === 0) off++; else break; }
    return { company: c.name, company_id: c.id, on, off, history: history.reverse() };
  }).sort((x, y) => (y.on - y.off) - (x.on - x.off));

  // ---- highlights (plain statements generated from the figures)
  const B = spec ? spec.label : { wk: 'this week', mtd: 'month to date', ytd: 'year to date' }[basis];
  const vsWhat = spec ? spec.compare.label : 'last week';
  const highlights = [];
  const pickList = rankings.companies.length ? rankings.companies : rankings.units;
  for (const m of pickList.filter((x) => ['REV_NET', 'REC_TOT', 'BD_CONF'].includes(x.code))) {
    const withT = m.list.filter((e) => e.pct != null);
    if (withT.length < 2) continue;
    const best = withT[0];
    const worst = withT[withT.length - 1];
    highlights.push({ good: true, text: `${best.name} leads ${m.name.toLowerCase()} ${B}: ${best.pct >= 0 ? '+' : ''}${best.pct.toFixed(1)}% vs budget` });
    highlights.push({ good: false, text: `${worst.name} trails ${m.name.toLowerCase()} ${B}: ${worst.pct >= 0 ? '+' : ''}${worst.pct.toFixed(1)}% vs budget` });
  }
  if (skus.length > 1) {
    const s0 = skus.find((s) => s.pct != null);
    const s1 = [...skus].reverse().find((s) => s.pct != null);
    if (s0) highlights.push({ good: true, text: `Best SKU: ${s0.sku} (${s0.company}) ${s0.pct >= 0 ? '+' : ''}${s0.pct.toFixed(1)}% vs budget` });
    if (s1 && s1 !== s0) highlights.push({ good: false, text: `Weakest SKU: ${s1.sku} (${s1.company}) ${s1.pct.toFixed(1)}% vs budget` });
  }
  const bigUp = movers.find((x) => x.good);
  const bigDown = movers.find((x) => !x.good);
  if (bigUp) highlights.push({ good: true, text: `Biggest improvement: ${bigUp.company} ${bigUp.metric.toLowerCase()} ${bigUp.pct >= 0 ? '+' : ''}${bigUp.pct.toFixed(1)}% vs ${vsWhat}` });
  if (bigDown) highlights.push({ good: false, text: `Biggest setback: ${bigDown.company} ${bigDown.metric.toLowerCase()} ${bigDown.pct >= 0 ? '+' : ''}${bigDown.pct.toFixed(1)}% vs ${vsWhat}` });
  const longOn = streaks.find((s) => s.on >= 3);
  if (longOn) highlights.push({ good: true, text: `${longOn.company} on or above net revenue budget ${longOn.on} weeks running` });
  const longOff = [...streaks].sort((a, b) => b.off - a.off).find((s) => s.off >= 3);
  if (longOff) highlights.push({ good: false, text: `${longOff.company} below net revenue budget ${longOff.off} weeks running` });
  const mEb = rankings.month.find((m) => m.code === 'PL_EBITDA')?.list.filter((e) => e.pct != null) || [];
  const mLabel = spec ? spec.label : P.monthLabel(M);
  if (mEb.length > 1) {
    highlights.push({ good: true, text: `${mLabel} EBITDA best: ${mEb[0].name} ${mEb[0].pct >= 0 ? '+' : ''}${mEb[0].pct.toFixed(1)}% vs budget` });
    highlights.push({ good: false, text: `${mLabel} EBITDA weakest: ${mEb.at(-1).name} ${mEb.at(-1).pct.toFixed(1)}% vs budget` });
  }

  return {
    node: { id: node.id, name: node.name, type: node.type, logo: node.meta?.logo || null }, path: pathOf(eng.tree, nodeId),
    week: P.describeWeek(W), basis, basis_label: B, month_label: spec ? spec.label : P.monthLabel(M), compare_label: vsWhat, period: spec ? { mode: spec.mode, label: spec.label, compare: spec.compare.label } : null,
    rankings, skus, movers: movers.slice(0, 12), streaks, highlights,
  };
}));

export default r;
