// npm run seed        -> clean start: structure, reporting lines, users (no figures)
// npm run seed:demo   -> same + sample SKUs, opening balances, budgets, weekly & monthly reports through the workflow
import bcrypt from 'bcryptjs';
import { db, tx } from './db.js';
import { Engine } from './engine.js';
import * as P from './periods.js';

const demo = process.argv.includes('--demo');
const TABLES = ['audit', 'workflow_log', 'month_filings', 'month_values', 'month_reports', 'filings', 'report_notes', 'report_adj', 'report_values',
  'reports', 'budget_month', 'budget_annual', 'company_setup', 'skus', 'user_scopes', 'users', 'fx_rates', 'lines', 'sections', 'nodes'];

let seed = 7;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const jitter = (p) => 1 + (rnd() - 0.5) * 2 * p;
const ids = {};
const COS = [['PHL', 'Pakistan Holstein'], ['RJF', 'Royal JW Foods'], ['RJB', 'Royal JW Buffalo'], ['JWA', 'JW Al-Arabia'], ['EPS', 'EPS Packages'], ['JWP', 'JW Packages']];
const users = {};

tx(() => {
  for (const t of TABLES) db.exec(`DELETE FROM ${t}`);
  db.exec('DELETE FROM sqlite_sequence');

  const node = db.prepare('INSERT INTO nodes(parent_id, type, code, name, currency, sort, meta) VALUES (?,?,?,?,?,?,?)');
  const add = (parent, type, code, name, sort, meta = {}) => (ids[code] = Number(node.run(parent, type, code, name, 'PKR', sort, JSON.stringify(meta)).lastInsertRowid));
  const G = add(null, 'group', 'JW', 'JW Group', 0, { short_name: 'JW' });
  const CG = add(G, 'cluster', 'CGC', 'Consumer Global Cluster', 1, { short_name: 'Consumer Global' });
  const SC = add(G, 'cluster', 'SCC', 'Supply Chain Cluster', 2, { short_name: 'Supply Chain' });
  COS.slice(0, 4).forEach(([c, n], i) => add(CG, 'company', c, n, i + 1));
  COS.slice(4).forEach(([c, n], i) => add(SC, 'company', c, n, i + 1));

  // ---------------------------------------------------------------- reporting lines
  const sec = db.prepare('INSERT INTO sections(code, name, scope, sort) VALUES (?,?,?,?)');
  sec.run('PNL', 'Profit & Loss', 'month', 1);
  sec.run('CF', 'Cash Flow', 'month', 2);
  sec.run('REVREC', 'Revenue & Recoveries', 'week', 3);
  sec.run('PRODSALES', 'Production & Sales', 'week', 4);
  sec.run('CASH', 'Payments & Cash Position', 'week', 5);

  const ins = db.prepare(`INSERT INTO lines(code, name, section, kind, scope, cf, formula, nature, fmt, hib, budget, note_required, is_kpi, system, sort)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,?)`);
  const lid = {};
  // code, name, section, parent, kind, formula, opts {cf, nature, fmt, hib, budget, note, kpi}
  const W = 'week';
  const Mo = 'month';
  const L = [
    ['PL_REV', 'Net revenue', 'PNL', null, 'link', 'REV_NET', Mo, {}],
    ['PL_COGS', 'Cost of sales', 'PNL', null, 'input', null, Mo, { hib: 0, budget: 1 }],
    ['PL_GP', 'Gross profit', 'PNL', null, 'formula', 'PL_REV - PL_COGS', Mo, { kpi: 1 }],
    ['PL_GP_PCT', 'Gross margin', 'PNL', null, 'formula', 'PL_GP / PL_REV * 100', Mo, { fmt: 'percent' }],
    ['PL_ADMIN', 'Administrative expenses', 'PNL', 'PL_OPEX', 'input', null, Mo, { hib: 0, budget: 1 }],
    ['PL_SELL', 'Selling & distribution expenses', 'PNL', 'PL_OPEX', 'input', null, Mo, { hib: 0, budget: 1 }],
    ['PL_OPEX', 'Operating expenses', 'PNL', null, 'sum', null, Mo, { hib: 0 }],
    ['PL_OTHINC', 'Other income', 'PNL', null, 'input', null, Mo, { budget: 1 }],
    ['PL_EBITDA', 'EBITDA', 'PNL', null, 'formula', 'PL_GP - PL_OPEX + PL_OTHINC', Mo, { kpi: 1 }],
    ['PL_EBITDA_PCT', 'EBITDA margin', 'PNL', null, 'formula', 'PL_EBITDA / PL_REV * 100', Mo, { fmt: 'percent' }],
    ['PL_DEP', 'Depreciation & amortisation', 'PNL', null, 'input', null, Mo, { hib: 0, budget: 1 }],
    ['PL_FIN', 'Finance cost', 'PNL', null, 'input', null, Mo, { hib: 0, budget: 1 }],
    ['PL_PBT', 'Profit before tax', 'PNL', null, 'formula', 'PL_EBITDA - PL_DEP - PL_FIN', Mo, {}],
    ['PL_TAX', 'Taxation', 'PNL', null, 'input', null, Mo, { hib: 0, budget: 1 }],
    ['PL_NP', 'Net profit', 'PNL', null, 'formula', 'PL_PBT - PL_TAX', Mo, { kpi: 1 }],
    ['PL_NP_PCT', 'Net profit margin', 'PNL', null, 'formula', 'PL_NP / PL_REV * 100', Mo, { fmt: 'percent' }],

    ['CF_OPEN', 'Opening cash & bank', 'CF', null, 'formula', 'CB_OPEN', Mo, {}],
    ['CF_OPS', 'Net cash from operations', 'CF', null, 'cfnet', 'OPS', Mo, {}],
    ['CF_INV', 'Net cash from investing', 'CF', null, 'cfnet', 'INV', Mo, {}],
    ['CF_FIN', 'Net cash from financing', 'CF', null, 'cfnet', 'FIN', Mo, {}],
    ['CF_OTHER', 'Other movements', 'CF', null, 'formula', 'CB_OTHER', Mo, {}],
    ['CF_NET', 'Net change in cash', 'CF', null, 'formula', 'CF_OPS + CF_INV + CF_FIN + CF_OTHER', Mo, {}],
    ['CF_CLOSE', 'Closing cash & bank', 'CF', null, 'formula', 'CF_OPEN + CF_NET', Mo, {}],

    ['REV_SKU', 'Sales (SKU-wise)', 'REVREC', 'REV_GROSS', 'sku_total', null, W, {}],
    ['REV_OTHER', 'Other revenue', 'REVREC', 'REV_GROSS', 'input', null, W, { budget: 1 }],
    ['REV_GROSS', 'Gross revenue', 'REVREC', null, 'sum', null, W, {}],
    ['REV_ADJ', 'Less: returns, discounts & rebates', 'REVREC', null, 'input', null, W, { hib: 0, budget: 1 }],
    ['REV_NET', 'Net revenue', 'REVREC', null, 'formula', 'REV_GROSS - REV_ADJ', W, { kpi: 1 }],
    ['REC_OPS', 'Operating – customers', 'REVREC', 'REC_TOT', 'input', null, W, { cf: '+OPS', budget: 1 }],
    ['REC_INV', 'Investing – asset sales, investment income', 'REVREC', 'REC_TOT', 'input', null, W, { cf: '+INV', budget: 1 }],
    ['REC_FIN', 'Financing – loans, equity received', 'REVREC', 'REC_TOT', 'input', null, W, { cf: '+FIN', budget: 1 }],
    ['REC_TOT', 'Total recoveries', 'REVREC', null, 'sum', null, W, { kpi: 1 }],
    ['PAY_OPS', 'Operating – suppliers, salaries, expenses', 'CASH', 'PAY_TOT', 'input', null, W, { cf: '-OPS', hib: 0, budget: 1 }],
    ['PAY_INV', 'Investing – capex', 'CASH', 'PAY_TOT', 'input', null, W, { cf: '-INV', hib: 0, budget: 1 }],
    ['PAY_FIN', 'Financing – loan repayments, markup, dividends', 'CASH', 'PAY_TOT', 'input', null, W, { cf: '-FIN', hib: 0, budget: 1 }],
    ['PAY_TOT', 'Total payments', 'CASH', null, 'sum', null, W, { hib: 0, kpi: 1 }],
    ['CB_OPEN', 'Opening cash & bank', 'CASH', null, 'opening', null, W, { nature: 'opening' }],
    ['NETCF', 'Net cash flow', 'CASH', null, 'formula', 'REC_TOT - PAY_TOT', W, {}],
    ['CB_OTHER', 'Other movements', 'CASH', null, 'input', null, W, { note: 1 }],
    ['CB_CLOSE', 'Closing cash & bank', 'CASH', null, 'formula', 'CB_OPEN + NETCF + CB_OTHER', W, { nature: 'closing', kpi: 1 }],
  ];
  L.forEach(([code, name, section, , kind, formula, scope, o], i) => {
    lid[code] = Number(ins.run(code, name, section, kind, scope, o.cf || null, formula, o.nature || 'flow', o.fmt || 'amount', o.hib ?? 1, o.budget || 0, o.note || 0, o.kpi || 0, (i + 1) * 10).lastInsertRowid);
  });
  const setParent = db.prepare('UPDATE lines SET parent_id = ? WHERE code = ?');
  L.forEach(([code, , , parent]) => parent && setParent.run(lid[parent], code));

  // ---------------------------------------------------------------- users
  const pw = (p) => bcrypt.hashSync(p, 8);
  const demoPw = pw('demo123');
  const u = db.prepare('INSERT INTO users(name, email, password_hash, role, title) VALUES (?,?,?,?,?)');
  const sc = db.prepare('INSERT INTO user_scopes(user_id, node_id) VALUES (?,?)');
  const user = (name, email, hash, role, title, scopes = []) => {
    const id = Number(u.run(name, email, hash, role, title).lastInsertRowid);
    scopes.forEach((s) => sc.run(id, s));
    users[email] = id;
    return id;
  };
  user('Group Finance Admin', 'admin@jwdash.local', pw('admin123'), 'admin', 'System administrator');
  user('Group CEO', 'ceo@jwdash.local', pw('ceo123'), 'executive', 'Chief Executive');
  user('Group Reviewer', 'group.reviewer@jwdash.local', demoPw, 'group_reviewer', 'Group CFO');
  user('Consumer Global Reviewer', 'cgc.reviewer@jwdash.local', demoPw, 'cluster_reviewer', 'Cluster Finance Head', [CG]);
  user('Supply Chain Reviewer', 'scc.reviewer@jwdash.local', demoPw, 'cluster_reviewer', 'Cluster Finance Head', [SC]);
  for (const [code, name] of COS) {
    user(`${name} DPO`, `${code.toLowerCase()}.dpo@jwdash.local`, demoPw, 'company_dpo', 'Data preparer', [ids[code]]);
    user(`${name} Reviewer`, `${code.toLowerCase()}.reviewer@jwdash.local`, demoPw, 'company_reviewer', 'Finance Manager', [ids[code]]);
  }
});

if (!demo) {
  console.log('Clean start loaded. admin@jwdash.local / admin123; other users / demo123');
  process.exit(0);
}

// ================================================================== demo figures
const PROFILES = {
  PHL: { skus: [['Raw milk', 'litres', 45000, 0.96, 210], ['Heifers', 'head', 0.4, 0.8, 450000]], other: 150e3, ret: 0.01, opex: 0.84, gm: 0.34, cash: 120e6 },
  RJF: { skus: [['UHT milk 1L', 'packs', 60000, 0.97, 290], ['Yogurt 500g', 'cups', 20000, 0.95, 180], ['Butter 200g', 'packs', 3000, 0.93, 520]], other: 80e3, ret: 0.025, opex: 0.86, gm: 0.27, cash: 180e6 },
  RJB: { skus: [['Buffalo milk', 'litres', 25000, 0.97, 230], ['Mozzarella', 'kg', 600, 0.9, 2400]], other: 40e3, ret: 0.015, opex: 0.85, gm: 0.3, cash: 70e6 },
  JWA: { skus: [['Fresh milk 1L', 'packs', 18000, 0.96, 320], ['Laban 1L', 'packs', 9000, 0.95, 280]], other: 30e3, ret: 0.02, opex: 0.87, gm: 0.26, cash: 60e6 },
  EPS: { skus: [['EPS boxes', 'pcs', 40000, 0.98, 55], ['EPS sheets', 'kg', 3000, 0.96, 650]], other: 60e3, ret: 0.01, opex: 0.88, gm: 0.22, cash: 45e6 },
  JWP: { skus: [['Corrugated cartons', 'pcs', 70000, 0.97, 85], ['Flexible packaging', 'kg', 5000, 0.95, 900]], other: 90e3, ret: 0.012, opex: 0.87, gm: 0.24, cash: 90e6 },
};
const PL = { PL_ADMIN: 0.06, PL_SELL: 0.07, PL_OTHINC: 0.005, PL_DEP: 0.025, PL_FIN: 0.02, PL_TAX: 0.025 };
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
      p.skus.forEach(([, , q, s, pr], i) => {
        bA.run(cid, fy, `SKU:${p.skuIds[i]}:PQ`, Math.round(q * 365 * up));
        bA.run(cid, fy, `SKU:${p.skuIds[i]}:SQ`, Math.round(q * s * 365 * up));
        bA.run(cid, fy, `SKU:${p.skuIds[i]}:SV`, Math.round(q * s * pr * 365 * up));
      });
      const rev = p.dailyRev * 365 * up;
      const net = rev * (1 - p.ret);
      bA.run(cid, fy, 'REV_OTHER', Math.round(p.other * 365 * up));
      bA.run(cid, fy, 'REV_ADJ', Math.round(rev * p.ret));
      bA.run(cid, fy, 'REC_OPS', Math.round(net * 0.98));
      bA.run(cid, fy, 'PAY_OPS', Math.round(net * p.opex));
      bA.run(cid, fy, 'PAY_FIN', Math.round(net * 0.04));
      bA.run(cid, fy, 'PL_COGS', Math.round(net * (1 - p.gm)));
      for (const [k, r] of Object.entries(PL)) bA.run(cid, fy, k, Math.round(net * r));
      if (fy === 2026) {
        bA.run(cid, fy, 'PAY_INV', Math.round(net * 0.05));
        bM.run(cid, '2026-09', 'PAY_INV', Math.round(net * 0.02));
        bM.run(cid, '2027-01', 'PAY_INV', Math.round(net * 0.02));
      }
    }
  }
});

const eng = new Engine();
const repIns = db.prepare('INSERT INTO reports(company_id, week_key, status, revision, remarks, updated_by, updated_at) VALUES (?,?,?,?,?,?,?)');
const valIns = db.prepare('INSERT INTO report_values(report_id, item, month_key, value) VALUES (?,?,?,?)');
const adjIns = db.prepare('INSERT INTO report_adj(report_id, item, value, reason) VALUES (?,?,?,?)');
const noteIns = db.prepare('INSERT INTO report_notes(report_id, item, note) VALUES (?,?,?)');
const filIns = db.prepare('INSERT INTO filings(report_id, company_id, week_key, revision, currency, data_json, filed_by, filed_at) VALUES (?,?,?,?,?,?,?,?)');
const wfRaw = db.prepare('INSERT INTO workflow_log(kind, company_id, period, action, from_status, to_status, user_id, user_email, user_name, comment, at) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
const wf = { run: (k, c, p, a, f, t, uid, cm, at) => { const u = db.prepare('SELECT email, name FROM users WHERE id = ?').get(uid); wfRaw.run(k, c, p, a, f, t, uid, u?.email ?? null, u?.name ?? null, cm, at); } };
const ts = (d, h) => new Date(d.getTime() + h * 3600000).toISOString().replace('T', ' ').slice(0, 19);

const STAGES = ['submitted', 'company_ok', 'cluster_ok', 'approved'];
function flow(kind, cid, code, period, base, final, cluster) {
  const who = [users[`${code.toLowerCase()}.dpo@jwdash.local`], users[`${code.toLowerCase()}.reviewer@jwdash.local`],
    users[`${cluster}.reviewer@jwdash.local`], users['group.reviewer@jwdash.local']];
  const upto = STAGES.indexOf(final);
  wf.run(kind, cid, period, 'submit', 'draft', 'submitted', who[0], null, ts(base, 0));
  for (let i = 1; i <= upto; i++) wf.run(kind, cid, period, 'approve', STAGES[i - 1], STAGES[i], who[i], null, ts(base, i * 5));
}

const ADJ = {
  'RJF|2026-W33': ['REC_OPS', 2400000, 'Distributor recovery received Sunday 9 Aug, missed in W32 report'],
  'PHL|2026-W36': ['PAY_OPS', 1150000, 'Feed supplier invoice of W35 posted after report'],
  'EPS|2026-W38': ['SV0', -820000, 'Invoice raised twice in W37, reversed'],
  'RJB|2026-W40': ['REV_ADJ', 310000, 'Rebate to Lahore distributor for W39 approved late'],
};
// latest weeks: where each company stands
const LATEST = { PHL: ['approved', 'cluster_ok', 'company_ok'], RJF: ['approved', 'cluster_ok', 'submitted'], RJB: ['cluster_ok', 'company_ok', 'reopened'],
  JWA: ['approved', 'company_ok', null], EPS: ['cluster_ok', 'company_ok', 'submitted'], JWP: ['cluster_ok', 'submitted', 'draft'] };

tx(() => {
  for (const [code, p] of Object.entries(PROFILES)) {
    const cid = ids[code];
    const c = eng.tree.byId.get(cid);
    const cluster = c.parent_id === ids.CGC ? 'cgc' : 'scc';
    weeks.forEach((w, wi) => {
      const fromEnd = weeks.length - 1 - wi;
      const target = fromEnd < 3 ? LATEST[code][2 - fromEnd] : 'approved';
      if (target === null) return;
      const values = {};
      const put = (item, month, v) => { (values[item] ||= {})[month] = v; };
      for (const s of P.segments(w)) {
        const d = s.days;
        const season = 1 + 0.06 * Math.sin((wi / 52) * 2 * Math.PI);
        let gross = 0;
        p.skus.forEach(([, , q, sr, pr], i) => {
          const prod = Math.round(q * d * jitter(0.08) * season);
          const sq = Math.round(prod * sr * jitter(0.05));
          const sv = Math.round((sq * pr * jitter(0.02)) / 1000) * 1000;
          put(`SKU:${p.skuIds[i]}:PQ`, s.month, prod);
          put(`SKU:${p.skuIds[i]}:SQ`, s.month, sq);
          put(`SKU:${p.skuIds[i]}:SV`, s.month, sv);
          gross += sv;
        });
        const k = (x) => Math.round(x / 1000) * 1000;
        const other = k(p.other * d * jitter(0.3));
        gross += other;
        const net = gross * (1 - p.ret);
        put('REV_OTHER', s.month, other);
        put('REV_ADJ', s.month, k(gross * p.ret * jitter(0.3)));
        put('REC_OPS', s.month, k(net * 0.97 * jitter(0.12)));
        put('PAY_OPS', s.month, k(net * p.opex * jitter(0.1)));
        if (s.closes_month || (wi % 9 === 4 && s === P.segments(w)[0])) put('PAY_FIN', s.month, k(net * 0.04 * 4.3 * jitter(0.1)));
        if (wi % 7 === 3) put('PAY_INV', s.month, k(net * 0.25 * jitter(0.3)));
        if (wi % 11 === 6) put('REC_INV', s.month, k(net * 0.03));
        if (code === 'RJB' && wi === 5) put('REC_FIN', s.month, 25e6);
      }
      const adj = {};
      const notes = {};
      const a = ADJ[`${code}|${w}`];
      if (a) adj[a[0] === 'SV0' ? `SKU:${p.skuIds[0]}:SV` : a[0]] = { value: a[1], reason: a[2] };
      if (code === 'RJF' && w === '2026-W35') { values.CB_OTHER = { [P.segments(w)[0].month]: -500000 }; notes.CB_OTHER = 'Bank charges & withholding on profit, per statement'; }
      const base = new Date(P.weekEnd(w).getTime() + 86400000 + 10 * 3600000);
      const filed = target !== 'draft';
      const rid = Number(repIns.run(cid, w, target, filed ? 1 : 0, wi % 5 === 0 ? 'Volumes in line with plan.' : '', null, ts(base, 0)).lastInsertRowid);
      for (const [item, byM] of Object.entries(values)) for (const [mo, v] of Object.entries(byM)) valIns.run(rid, item, mo, v);
      for (const [item, x] of Object.entries(adj)) adjIns.run(rid, item, x.value, x.reason);
      for (const [item, n] of Object.entries(notes)) noteIns.run(rid, item, n);
      if (!filed) return;
      const d = { values, adj, notes, remarks: '' };
      eng.setDraft(cid, w, d);
      const reported = {};
      for (const s of P.segments(w)) reported[s.month] = eng.companyVectors(c, w, s.month, false).V.mtdA;
      filIns.run(rid, cid, w, 1, 'PKR', JSON.stringify({ ...d, reported }), users[`${code.toLowerCase()}.dpo@jwdash.local`], ts(base, 0));
      if (target === 'reopened') {
        flow('week', cid, code, w, base, 'submitted', cluster);
        db.prepare('UPDATE reports SET reopened = 1 WHERE id = ?').run(rid);
        wf.run('week', cid, w, 'reopen', 'submitted', 'reopened', users['group.reviewer@jwdash.local'], 'Mozzarella sales value looks low against dispatch log; please recheck and resubmit.', ts(base, 4));
      } else flow('week', cid, code, w, base, target, cluster);
    });
  }
});

// ---- month close: P&L for completed months
const eng2 = new Engine();
const mrIns = db.prepare('INSERT INTO month_reports(company_id, month_key, status, revision, remarks, updated_by, updated_at) VALUES (?,?,?,?,?,?,?)');
const mvIns = db.prepare('INSERT INTO month_values(report_id, item, value) VALUES (?,?,?)');
const mfIns = db.prepare('INSERT INTO month_filings(report_id, company_id, month_key, revision, data_json, filed_by, filed_at) VALUES (?,?,?,?,?,?,?)');
const MONTHS = { '2026-07': 'approved', '2026-08': 'approved' };
const SEP = { PHL: 'approved', RJF: 'cluster_ok', RJB: 'company_ok', JWA: 'submitted', EPS: 'draft', JWP: null };
tx(() => {
  for (const [code, p] of Object.entries(PROFILES)) {
    const cid = ids[code];
    const cluster = eng2.tree.byId.get(cid).parent_id === ids.CGC ? 'cgc' : 'scc';
    for (const [M, st0] of [...Object.entries(MONTHS), ['2026-09', SEP[code]]]) {
      if (!st0 || !eng2.monthReady(cid, M)) continue;
      const v = eng2.monthView(cid, M, LAST, { children: false });
      const net = v.sections.flatMap((s) => s.rows).find((r) => r.code === 'REV_NET').m.a;
      const values = { PL_COGS: Math.round(net * (1 - p.gm) * jitter(0.04) / 1000) * 1000 };
      for (const [k, r] of Object.entries(PL)) values[k] = Math.round(net * r * jitter(0.15) / 1000) * 1000;
      const base = new Date(P.monthEnd(M).getTime() + 6 * 86400000);
      const filed = st0 !== 'draft';
      const rid = Number(mrIns.run(cid, M, st0, filed ? 1 : 0, '', null, ts(base, 0)).lastInsertRowid);
      for (const [k, x] of Object.entries(values)) mvIns.run(rid, k, x);
      if (!filed) continue;
      mfIns.run(rid, cid, M, 1, JSON.stringify({ values, remarks: '' }), users[`${code.toLowerCase()}.dpo@jwdash.local`], ts(base, 0));
      flow('month', cid, code, M, base, st0, cluster);
    }
  }
});

console.log(`Demo loaded: ${weeks.length} weeks (${START} to ${LAST}), month close Jul–Sep.`);
console.log('admin@jwdash.local / admin123 · ceo@jwdash.local / ceo123 · others / demo123');
