// npm run seed          -> clean start: group structure, reporting packs, admin users (no figures)
// npm run seed:demo     -> same + sample SKUs, opening balances, budgets and weekly reports
import bcrypt from 'bcryptjs';
import { db, tx } from './db.js';
import { Engine } from './engine.js';
import * as P from './periods.js';

const demo = process.argv.includes('--demo');

const TABLES = ['audit', 'filings', 'report_notes', 'report_adj', 'report_values', 'reports', 'budget_month', 'budget_annual',
  'company_setup', 'skus', 'users', 'fx_rates', 'lines', 'sections', 'nodes'];

let seed = 7;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const jitter = (p) => 1 + (rnd() - 0.5) * 2 * p;

const ids = {};

tx(() => {
  for (const t of TABLES) db.exec(`DELETE FROM ${t}`);
  db.exec('DELETE FROM sqlite_sequence');

  // ---------------------------------------------------------------- structure
  const node = db.prepare('INSERT INTO nodes(parent_id, type, code, name, currency, sort) VALUES (?,?,?,?,?,?)');
  const add = (parent, type, code, name, sort) => (ids[code] = Number(node.run(parent, type, code, name, 'PKR', sort).lastInsertRowid));
  const G = add(null, 'group', 'JW', 'JW Group', 0);
  const CG = add(G, 'cluster', 'CGC', 'Consumer Global Cluster', 1);
  const SC = add(G, 'cluster', 'SCC', 'Supply Chain Cluster', 2);
  add(CG, 'company', 'PHL', 'Pakistan Holstein', 1);
  add(CG, 'company', 'RJF', 'Royal JW Foods', 2);
  add(CG, 'company', 'RJB', 'Royal JW Buffalo', 3);
  add(CG, 'company', 'JWA', 'JW Al-Arabia', 4);
  add(SC, 'company', 'EPS', 'EPS Packages', 1);
  add(SC, 'company', 'JWP', 'JW Packages', 2);

  // ---------------------------------------------------------------- reporting packs
  const sec = db.prepare('INSERT INTO sections(code, name, sort) VALUES (?,?,?)');
  sec.run('REVREC', 'Revenue & Recoveries', 1);
  sec.run('PRODSALES', 'Production & Sales', 2);
  sec.run('CASH', 'Payments & Cash Position', 3);
  sec.run('PROFIT', 'Profitability', 4);

  const ins = db.prepare(`INSERT INTO lines(code, name, section, parent_id, kind, formula, nature, fmt, hib, budget, note_required, is_kpi, system, sort)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,?)`);
  const lid = {};
  // code, name, section, parent, kind, formula, nature, fmt, hib, budget, note, kpi
  const L = [
    ['REV_SKU', 'Sales (SKU-wise)', 'REVREC', 'REV_GROSS', 'sku_total', null, 'flow', 'amount', 1, 0, 0, 0],
    ['REV_OTHER', 'Other revenue', 'REVREC', 'REV_GROSS', 'input', null, 'flow', 'amount', 1, 1, 0, 0],
    ['REV_GROSS', 'Gross revenue', 'REVREC', null, 'sum', null, 'flow', 'amount', 1, 0, 0, 0],
    ['REV_ADJ', 'Less: returns, discounts & rebates', 'REVREC', null, 'input', null, 'flow', 'amount', 0, 1, 0, 0],
    ['REV_NET', 'Net revenue', 'REVREC', null, 'formula', 'REV_GROSS - REV_ADJ', 'flow', 'amount', 1, 0, 0, 1],
    ['REC_OPS', 'Operating – customers', 'REVREC', 'REC_TOT', 'input', null, 'flow', 'amount', 1, 1, 0, 0],
    ['REC_INV', 'Investing – asset sales, investment income', 'REVREC', 'REC_TOT', 'input', null, 'flow', 'amount', 1, 1, 0, 0],
    ['REC_FIN', 'Financing – loans, equity received', 'REVREC', 'REC_TOT', 'input', null, 'flow', 'amount', 1, 1, 0, 0],
    ['REC_TOT', 'Total recoveries', 'REVREC', null, 'sum', null, 'flow', 'amount', 1, 0, 0, 1],
    ['PAY_OPS', 'Operating – suppliers, salaries, expenses', 'CASH', 'PAY_TOT', 'input', null, 'flow', 'amount', 0, 1, 0, 0],
    ['PAY_INV', 'Investing – capex', 'CASH', 'PAY_TOT', 'input', null, 'flow', 'amount', 0, 1, 0, 0],
    ['PAY_FIN', 'Financing – loan repayments, markup, dividends', 'CASH', 'PAY_TOT', 'input', null, 'flow', 'amount', 0, 1, 0, 0],
    ['PAY_TOT', 'Total payments', 'CASH', null, 'sum', null, 'flow', 'amount', 0, 0, 0, 1],
    ['CB_OPEN', 'Opening cash & bank', 'CASH', null, 'opening', null, 'opening', 'amount', 1, 0, 0, 0],
    ['NETCF', 'Net cash flow', 'CASH', null, 'formula', 'REC_TOT - PAY_TOT', 'flow', 'amount', 1, 0, 0, 0],
    ['CB_OTHER', 'Other movements', 'CASH', null, 'input', null, 'flow', 'amount', 1, 0, 1, 0],
    ['CB_CLOSE', 'Closing cash & bank', 'CASH', null, 'formula', 'CB_OPEN + NETCF + CB_OTHER', 'closing', 'amount', 1, 0, 0, 1],
    ['EBITDA', 'EBITDA', 'PROFIT', null, 'input', null, 'flow', 'amount', 1, 1, 0, 1],
    ['EBITDA_PCT', 'EBITDA margin', 'PROFIT', null, 'formula', 'EBITDA / REV_NET * 100', 'flow', 'percent', 1, 0, 0, 0],
    ['NP', 'Net profit', 'PROFIT', null, 'input', null, 'flow', 'amount', 1, 1, 0, 1],
    ['NP_PCT', 'Net profit margin', 'PROFIT', null, 'formula', 'NP / REV_NET * 100', 'flow', 'percent', 1, 0, 0, 0],
  ];
  L.forEach((l, i) => { lid[l[0]] = Number(ins.run(l[0], l[1], l[2], null, l[4], l[5], l[6], l[7], l[8], l[9], l[10], l[11], (i + 1) * 10).lastInsertRowid); });
  const setParent = db.prepare('UPDATE lines SET parent_id = ? WHERE code = ?');
  L.forEach((l) => l[3] && setParent.run(lid[l[3]], l[0]));

  // ---------------------------------------------------------------- users
  const pw = (p) => bcrypt.hashSync(p, 10);
  const user = db.prepare('INSERT INTO users(name, email, password_hash, role, node_id) VALUES (?,?,?,?,?)');
  user.run('Group Finance', 'admin@jwdash.local', pw('admin123'), 'admin', null);
  user.run('Group CEO', 'ceo@jwdash.local', pw('ceo123'), 'executive', null);
  if (demo) {
    user.run('Consumer Cluster Head', 'consumer@jwdash.local', pw('demo123'), 'cluster', CG);
    user.run('Supply Chain Cluster Head', 'supply@jwdash.local', pw('demo123'), 'cluster', SC);
    for (const [code, email] of [['PHL', 'holstein'], ['RJF', 'foods'], ['RJB', 'buffalo'], ['JWA', 'arabia'], ['EPS', 'eps'], ['JWP', 'packages']]) {
      user.run(`${code} Accountant`, `${email}@jwdash.local`, pw('demo123'), 'company', ids[code]);
    }
  }
});

if (!demo) {
  console.log('Clean start loaded. Login: admin@jwdash.local / admin123');
  process.exit(0);
}

// ================================================================== demo figures
// daily volumes / prices (sample only)
const PROFILES = {
  PHL: { skus: [['Raw milk', 'litres', 45000, 0.96, 210], ['Heifers', 'head', 0.4, 0.8, 450000]], other: 150e3, ret: 0.01, opex: 0.84, ebitda: 0.17, np: 0.08, cash: 120e6 },
  RJF: { skus: [['UHT milk 1L', 'packs', 60000, 0.97, 290], ['Yogurt 500g', 'cups', 20000, 0.95, 180], ['Butter 200g', 'packs', 3000, 0.93, 520]], other: 80e3, ret: 0.025, opex: 0.86, ebitda: 0.13, np: 0.06, cash: 180e6 },
  RJB: { skus: [['Buffalo milk', 'litres', 25000, 0.97, 230], ['Mozzarella', 'kg', 600, 0.9, 2400]], other: 40e3, ret: 0.015, opex: 0.85, ebitda: 0.15, np: 0.07, cash: 70e6 },
  JWA: { skus: [['Fresh milk 1L', 'packs', 18000, 0.96, 320], ['Laban 1L', 'packs', 9000, 0.95, 280]], other: 30e3, ret: 0.02, opex: 0.87, ebitda: 0.12, np: 0.05, cash: 60e6 },
  EPS: { skus: [['EPS boxes', 'pcs', 40000, 0.98, 55], ['EPS sheets', 'kg', 3000, 0.96, 650]], other: 60e3, ret: 0.01, opex: 0.88, ebitda: 0.11, np: 0.05, cash: 45e6 },
  JWP: { skus: [['Corrugated cartons', 'pcs', 70000, 0.97, 85], ['Flexible packaging', 'kg', 5000, 0.95, 900]], other: 90e3, ret: 0.012, opex: 0.87, ebitda: 0.12, np: 0.055, cash: 90e6 },
};
const START = '2026-W27';
const LAST = P.lastClosedWeek();
const weeks = P.weekRange(START, LAST);

tx(() => {
  const skuIns = db.prepare('INSERT INTO skus(company_id, code, name, unit, sort) VALUES (?,?,?,?,?)');
  const setupIns = db.prepare('INSERT INTO company_setup(company_id, start_week, opening_cash) VALUES (?,?,?)');
  const bA = db.prepare('INSERT INTO budget_annual(company_id, fy, item, value) VALUES (?,?,?,?)');
  const bM = db.prepare('INSERT INTO budget_month(company_id, month_key, item, value) VALUES (?,?,?,?)');
  for (const [code, p] of Object.entries(PROFILES)) {
    const cid = ids[code];
    p.skuIds = p.skus.map(([name, unit], i) => Number(skuIns.run(cid, name.toUpperCase().replace(/[^A-Z0-9]+/g, '-'), name, unit, (i + 1) * 10).lastInsertRowid));
    setupIns.run(cid, START, p.cash);
    p.dailyRev = p.skus.reduce((a, [, , q, s, pr]) => a + q * s * pr, 0) + p.other;
    for (const fy of [2025, 2026]) {
      const up = fy === 2026 ? 1.08 : 1.0;
      const days = fy === 2025 ? 365 : 365;
      p.skus.forEach(([, , q, s, pr], i) => {
        bA.run(cid, fy, `SKU:${p.skuIds[i]}:PQ`, Math.round(q * days * up));
        bA.run(cid, fy, `SKU:${p.skuIds[i]}:SQ`, Math.round(q * s * days * up));
        bA.run(cid, fy, `SKU:${p.skuIds[i]}:SV`, Math.round(q * s * pr * days * up));
      });
      const rev = p.dailyRev * days * up;
      bA.run(cid, fy, 'REV_OTHER', Math.round(p.other * days * up));
      bA.run(cid, fy, 'REV_ADJ', Math.round(rev * p.ret));
      bA.run(cid, fy, 'REC_OPS', Math.round(rev * (1 - p.ret) * 0.98));
      bA.run(cid, fy, 'PAY_OPS', Math.round(rev * p.opex));
      bA.run(cid, fy, 'PAY_FIN', Math.round(rev * 0.04));
      bA.run(cid, fy, 'EBITDA', Math.round(rev * p.ebitda));
      bA.run(cid, fy, 'NP', Math.round(rev * p.np));
      if (fy === 2026) {
        // capex planned for specific months, the rest spread
        bA.run(cid, fy, 'PAY_INV', Math.round(rev * 0.05));
        bM.run(cid, '2026-09', 'PAY_INV', Math.round(rev * 0.02));
        bM.run(cid, '2027-01', 'PAY_INV', Math.round(rev * 0.02));
      }
    }
  }
});

const eng = new Engine();
const repIns = db.prepare("INSERT INTO reports(company_id, week_key, status, revision, remarks, updated_by, updated_at) VALUES (?,?,?,?,?,?,?)");
const valIns = db.prepare('INSERT INTO report_values(report_id, item, month_key, value) VALUES (?,?,?,?)');
const adjIns = db.prepare('INSERT INTO report_adj(report_id, item, value, reason) VALUES (?,?,?,?)');
const noteIns = db.prepare('INSERT INTO report_notes(report_id, item, note) VALUES (?,?,?)');
const filIns = db.prepare('INSERT INTO filings(report_id, company_id, week_key, revision, currency, data_json, filed_by, filed_at) VALUES (?,?,?,?,?,?,?,?)');

const ADJ = {
  'RJF|2026-W33': ['REC_OPS', 2400000, 'Distributor recovery received Sunday 9 Aug, missed in W32 report'],
  'PHL|2026-W36': ['PAY_OPS', 1150000, 'Feed supplier invoice of W35 posted after report'],
  'EPS|2026-W38': ['SKU:0:SV', -820000, 'Invoice raised twice in W37, reversed'],
  'RJB|2026-W40': ['REV_ADJ', 310000, 'Rebate to Lahore distributor for W39 approved late'],
};

tx(() => {
  for (const [code, p] of Object.entries(PROFILES)) {
    const cid = ids[code];
    const c = eng.tree.byId.get(cid);
    weeks.forEach((w, wi) => {
      const latest = w === LAST;
      if (latest && code === 'JWA') return; // not reported yet
      const draft = latest && code === 'JWP';
      const values = {};
      const put = (item, month, v) => { (values[item] ||= {})[month] = v; };
      for (const s of P.segments(w)) {
        const d = s.days;
        const season = 1 + 0.06 * Math.sin((wi / 52) * 2 * Math.PI);
        let gross = 0;
        p.skus.forEach(([, unit, q, sr, pr], i) => {
          const prod = q * d * jitter(0.08) * season;
          const sq = prod * sr * jitter(0.05);
          const r = (x) => (unit === 'head' ? Math.round(x) : Math.round(x));
          const sv = Math.round((r(sq) * pr * jitter(0.02)) / 1000) * 1000;
          put(`SKU:${p.skuIds[i]}:PQ`, s.month, r(prod));
          put(`SKU:${p.skuIds[i]}:SQ`, s.month, r(sq));
          put(`SKU:${p.skuIds[i]}:SV`, s.month, sv);
          gross += sv;
        });
        const other = Math.round(p.other * d * jitter(0.3) / 1000) * 1000;
        gross += other;
        const net = gross * (1 - p.ret);
        const k = (x) => Math.round(x / 1000) * 1000;
        put('REV_OTHER', s.month, other);
        put('REV_ADJ', s.month, k(gross * p.ret * jitter(0.3)));
        put('REC_OPS', s.month, k(net * 0.97 * jitter(0.12)));
        put('PAY_OPS', s.month, k(net * p.opex * jitter(0.1)));
        if (s.closes_month || (wi % 9 === 4 && s === P.segments(w)[0])) put('PAY_FIN', s.month, k(net * 0.04 * 4.3 * jitter(0.1)));
        if (wi % 7 === 3) put('PAY_INV', s.month, k(net * 0.25 * jitter(0.3)));
        if (wi % 11 === 6) put('REC_INV', s.month, k(net * 0.03));
        if (code === 'RJB' && wi === 5) put('REC_FIN', s.month, 25e6);
        put('EBITDA', s.month, k(net * p.ebitda * jitter(0.15)));
        put('NP', s.month, k(net * p.np * jitter(0.2)));
      }
      const adj = {};
      const notes = {};
      const a = ADJ[`${code}|${w}`];
      if (a) adj[a[0] === 'SKU:0:SV' ? `SKU:${p.skuIds[0]}:SV` : a[0]] = { value: a[1], reason: a[2] };
      if (code === 'RJF' && w === '2026-W35') { values.CB_OTHER = { [P.segments(w)[0].month]: -500000 }; notes.CB_OTHER = 'Bank charges & withholding on profit, per statement'; }
      const remarks = wi % 5 === 0 ? 'Volumes in line with plan.' : '';
      const at = new Date(P.weekEnd(w).getTime() + 86400000 + 10 * 3600000).toISOString().replace('T', ' ').slice(0, 19);
      const rid = Number(repIns.run(cid, w, draft ? 'draft' : 'filed', draft ? 0 : 1, remarks, null, at).lastInsertRowid);
      for (const [item, byM] of Object.entries(values)) for (const [mo, v] of Object.entries(byM)) valIns.run(rid, item, mo, v);
      for (const [item, x] of Object.entries(adj)) adjIns.run(rid, item, x.value, x.reason);
      for (const [item, n] of Object.entries(notes)) noteIns.run(rid, item, n);
      if (draft) return;
      const d = { values, adj, notes, remarks };
      eng.setDraft(cid, w, d);
      const reported = {};
      for (const s of P.segments(w)) reported[s.month] = eng.companyVectors(c, w, s.month, false).V.mtdA;
      filIns.run(rid, cid, w, 1, 'PKR', JSON.stringify({ ...d, reported }), null, at);
    });
  }
});

console.log(`Demo loaded: ${weeks.length} weeks (${START} to ${LAST}).`);
console.log('Logins: admin@jwdash.local / admin123 · ceo@jwdash.local / ceo123 · holstein@, foods@, buffalo@, arabia@, eps@, packages@, consumer@, supply@jwdash.local / demo123');
