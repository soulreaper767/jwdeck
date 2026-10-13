// Loads a demo JW Group: company tree, standard heads, per-company formats, users and ~2 years of filed history.
// Usage: npm run seed            (only if the database is empty)
//        npm run seed -- --reset (wipes all data first)
import bcrypt from 'bcryptjs';
import { db, tx } from './db.js';
import { computeLines, headTotalsFromLines } from './consol.js';
import * as P from './periods.js';

const reset = process.argv.includes('--reset');
if (db.prepare('SELECT COUNT(*) c FROM users').get().c && !reset) {
  console.log('Database already has data. Use "npm run seed -- --reset" to wipe and reseed.');
  process.exit(0);
}

let seed = 42;
const rand = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };

tx(() => {
  if (reset) {
    for (const t of ['audit', 'filings', 'submission_values', 'submissions', 'company_lines', 'users', 'fx_rates', 'heads', 'nodes']) {
      db.exec(`DELETE FROM ${t}`);
    }
    db.exec("DELETE FROM sqlite_sequence");
  }

  // ------------------------------------------------------------ standard heads
  // [code, name, parentCode, type, opts]
  const HEADS = [
    ['REV', 'Revenue', null, 'group', { kpi: 1 }],
    ['REV_LOCAL', 'Local sales', 'REV', 'input'],
    ['REV_EXPORT', 'Export sales', 'REV', 'input'],
    ['REV_OTHER', 'Other operating income', 'REV', 'input'],
    ['COGS', 'Cost of sales', null, 'group', { hib: 0, freq: 'monthly' }],
    ['COGS_MAT', 'Materials consumed', 'COGS', 'input', { hib: 0, freq: 'monthly' }],
    ['COGS_LAB', 'Direct labour', 'COGS', 'input', { hib: 0, freq: 'monthly' }],
    ['COGS_OH', 'Direct overheads', 'COGS', 'input', { hib: 0, freq: 'monthly' }],
    ['GP', 'Gross profit', null, 'formula', { f: 'REV - COGS', kpi: 1, freq: 'monthly' }],
    ['GP_PCT', 'Gross margin %', null, 'formula', { f: 'GP / REV * 100', fmt: 'percent', freq: 'monthly' }],
    ['OPEX', 'Operating expenses', null, 'group', { hib: 0, freq: 'monthly' }],
    ['OPEX_ADMIN', 'Administrative expenses', 'OPEX', 'input', { hib: 0, freq: 'monthly' }],
    ['OPEX_SELL', 'Selling & distribution', 'OPEX', 'input', { hib: 0, freq: 'monthly' }],
    ['OPEX_OTHER', 'Other operating expenses', 'OPEX', 'input', { hib: 0, freq: 'monthly' }],
    ['EBITDA', 'EBITDA', null, 'formula', { f: 'GP - OPEX', kpi: 1, freq: 'monthly' }],
    ['EBITDA_PCT', 'EBITDA margin %', null, 'formula', { f: 'EBITDA / REV * 100', fmt: 'percent', freq: 'monthly' }],
    ['DEP', 'Depreciation & amortisation', null, 'input', { hib: 0, freq: 'monthly' }],
    ['FIN', 'Finance cost', null, 'input', { hib: 0, freq: 'monthly' }],
    ['PBT', 'Profit before tax', null, 'formula', { f: 'EBITDA - DEP - FIN', freq: 'monthly' }],
    ['TAX', 'Taxation', null, 'input', { hib: 0, freq: 'monthly' }],
    ['NP', 'Net profit', null, 'formula', { f: 'PBT - TAX', kpi: 1, freq: 'monthly' }],
    ['NP_PCT', 'Net margin %', null, 'formula', { f: 'NP / REV * 100', fmt: 'percent', freq: 'monthly' }],
    ['CF', 'Cash movement', null, 'section', { st: 'CF' }],
    ['COLL', 'Collections from customers', 'CF', 'input', { st: 'CF', kpi: 1 }],
    ['PAYM', 'Payments to suppliers & staff', 'CF', 'input', { st: 'CF', hib: 0 }],
    ['NETCF', 'Net operating cash flow', 'CF', 'formula', { st: 'CF', f: 'COLL - PAYM', kpi: 1 }],
    ['ORDERS', 'Orders booked', 'CF', 'input', { st: 'KPI' }],
    ['BS', 'Position at period end', null, 'section', { st: 'BS', nature: 'balance' }],
    ['CASH', 'Cash & bank balance', 'BS', 'input', { st: 'BS', nature: 'balance', kpi: 1 }],
    ['RECV', 'Trade receivables', 'BS', 'input', { st: 'BS', nature: 'balance', hib: 0 }],
    ['INV', 'Inventory', 'BS', 'input', { st: 'BS', nature: 'balance', hib: 0, freq: 'monthly' }],
    ['PAY', 'Trade payables', 'BS', 'input', { st: 'BS', nature: 'balance', hib: 0, freq: 'monthly' }],
    ['NWC', 'Net working capital (excl. cash)', 'BS', 'formula', { st: 'BS', nature: 'balance', f: 'RECV + INV - PAY', hib: 0, freq: 'monthly' }],
    ['DEBT', 'Borrowings', 'BS', 'input', { st: 'BS', nature: 'balance', hib: 0, freq: 'monthly' }],
    ['HC', 'Headcount', 'BS', 'input', { st: 'KPI', nature: 'balance', fmt: 'number', freq: 'monthly' }],
  ];
  const headId = {};
  const insHead = db.prepare(`INSERT INTO heads(parent_id, code, name, statement, head_type, nature, formula, fmt, higher_is_better, frequency, is_kpi, sort)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  HEADS.forEach(([code, name, parent, type, o = {}], i) => {
    const info = insHead.run(parent ? headId[parent] : null, code, name, o.st || 'PL', type, o.nature || 'flow', o.f || null,
      o.fmt || 'amount', o.hib ?? 1, o.freq || 'both', o.kpi || 0, (i + 1) * 10);
    headId[code] = Number(info.lastInsertRowid);
  });

  // ------------------------------------------------------------ tree
  const insNode = db.prepare('INSERT INTO nodes(parent_id, type, code, name, currency, sort) VALUES (?,?,?,?,?,?)');
  const node = (parent, type, code, name, ccy = 'PKR', sort = 0) =>
    Number(insNode.run(parent, type, code, name, ccy, sort).lastInsertRowid);
  const G = node(null, 'group', 'JW', 'JW Group');
  const TEX = node(G, 'cluster', 'TEX', 'Textiles', 'PKR', 1);
  const RE = node(G, 'cluster', 'RE', 'Real Estate', 'PKR', 2);
  const TECH = node(G, 'cluster', 'TECH', 'Technology', 'PKR', 3);
  const TRD = node(G, 'cluster', 'TRD', 'Trading & Agri', 'PKR', 4);
  const TRD_AG = node(TRD, 'cluster', 'TRD-AG', 'Agri Inputs', 'PKR', 1);

  // ------------------------------------------------------------ company formats
  // line: [code, label, type, head|formula, base(monthly), opts]
  const SPIN = {
    monthly: [
      ['H1', 'SALES', 'header'],
      ['S_YL', 'Yarn sales – local', 'input', 'REV_LOCAL', 820e6],
      ['S_YE', 'Yarn sales – export', 'input', 'REV_EXPORT', 540e6],
      ['S_W', 'Waste sales', 'input', 'REV_OTHER', 22e6],
      ['S_T', 'Net sales', 'formula', 'S_YL + S_YE + S_W', 0, { bold: 1 }],
      ['H2', 'COST OF GOODS MANUFACTURED', 'header'],
      ['C_RC', 'Raw cotton consumed', 'input', 'COGS_MAT', 690e6, { i: 1 }],
      ['C_PF', 'Polyester fibre consumed', 'input', 'COGS_MAT', 160e6, { i: 1 }],
      ['C_SW', 'Salaries & wages – mill', 'input', 'COGS_LAB', 95e6, { i: 1 }],
      ['C_FP', 'Fuel & power', 'input', 'COGS_OH', 140e6, { i: 1 }],
      ['C_SS', 'Stores & spares', 'input', 'COGS_OH', 28e6, { i: 1 }],
      ['C_T', 'Cost of sales', 'formula', 'C_RC + C_PF + C_SW + C_FP + C_SS', 0, { bold: 1 }],
      ['GPL', 'Gross profit', 'formula', 'S_T - C_T', 0, { bold: 1 }],
      ['E_AD', 'Administrative expenses', 'input', 'OPEX_ADMIN', 42e6],
      ['E_DS', 'Distribution cost', 'input', 'OPEX_SELL', 31e6],
      ['E_FC', 'Finance cost', 'input', 'FIN', 38e6],
      ['E_DP', 'Depreciation', 'input', 'DEP', 34e6],
      ['PBTL', 'Profit before taxation', 'formula', 'GPL - E_AD - E_DS - E_FC - E_DP', 0, { bold: 1 }],
      ['E_TX', 'Taxation', 'input', 'TAX', 14e6],
      ['PATL', 'Profit after taxation', 'formula', 'PBTL - E_TX', 0, { bold: 1 }],
      ['H3', 'CASH & POSITION', 'header'],
      ['K_CL', 'Collections', 'input', 'COLL', 1330e6],
      ['K_PY', 'Payments', 'input', 'PAYM', 1230e6],
      ['K_CB', 'Cash & bank (closing)', 'input', 'CASH', 210e6, { bal: 1 }],
      ['K_DR', 'Debtors', 'input', 'RECV', 900e6, { bal: 1 }],
      ['K_ST', 'Stock in trade', 'input', 'INV', 1450e6, { bal: 1 }],
      ['K_CR', 'Creditors', 'input', 'PAY', 610e6, { bal: 1 }],
      ['K_LN', 'Bank borrowings', 'input', 'DEBT', 2100e6, { bal: 1 }],
      ['K_HC', 'Employees on payroll', 'input', 'HC', 1450, { bal: 1, int: 1 }],
    ],
    weekly: [
      ['W_YL', 'Yarn dispatched – local (value)', 'input', 'REV_LOCAL', 820e6 / 4.33],
      ['W_YE', 'Yarn shipped – export (value)', 'input', 'REV_EXPORT', 540e6 / 4.33],
      ['W_T', 'Total dispatches', 'formula', 'W_YL + W_YE', 0, { bold: 1 }],
      ['W_CL', 'Collections', 'input', 'COLL', 1330e6 / 4.33],
      ['W_PY', 'Payments', 'input', 'PAYM', 1230e6 / 4.33],
      ['W_CB', 'Cash & bank (Friday close)', 'input', 'CASH', 210e6, { bal: 1 }],
      ['W_OB', 'Yarn orders booked', 'input', 'ORDERS', 1350e6 / 4.33],
    ],
  };
  const WEAVE = {
    monthly: [
      ['R1', 'Greige fabric sales', 'input', 'REV_LOCAL', 410e6],
      ['R2', 'Export – processed fabric', 'input', 'REV_EXPORT', 300e6],
      ['RT', 'Turnover', 'formula', 'R1 + R2', 0, { bold: 1 }],
      ['M1', 'Yarn consumed', 'input', 'COGS_MAT', 420e6],
      ['M2', 'Processing charges', 'input', 'COGS_OH', 70e6],
      ['M3', 'Loom shed wages', 'input', 'COGS_LAB', 48e6],
      ['GM', 'Gross margin', 'formula', 'RT - M1 - M2 - M3', 0, { bold: 1 }],
      ['X1', 'Overheads – admin', 'input', 'OPEX_ADMIN', 25e6],
      ['X2', 'Freight & export expenses', 'input', 'OPEX_SELL', 21e6],
      ['X3', 'Mark-up on loans', 'input', 'FIN', 16e6],
      ['X4', 'Depreciation', 'input', 'DEP', 19e6],
      ['X5', 'Tax provision', 'input', 'TAX', 8e6],
      ['NPL', 'Net profit', 'formula', 'GM - X1 - X2 - X3 - X4 - X5', 0, { bold: 1 }],
      ['B1', 'Receipts from customers', 'input', 'COLL', 690e6],
      ['B2', 'Disbursements', 'input', 'PAYM', 650e6],
      ['B3', 'Bank balances', 'input', 'CASH', 85e6, { bal: 1 }],
      ['B4', 'Receivables', 'input', 'RECV', 520e6, { bal: 1 }],
      ['B5', 'Inventory – yarn & fabric', 'input', 'INV', 610e6, { bal: 1 }],
      ['B6', 'Payables', 'input', 'PAY', 330e6, { bal: 1 }],
      ['B7', 'Running finance', 'input', 'DEBT', 780e6, { bal: 1 }],
      ['B8', 'Headcount', 'input', 'HC', 620, { bal: 1, int: 1 }],
    ],
    weekly: [
      ['WS', 'Fabric sales (all)', 'input', 'REV_LOCAL', 710e6 / 4.33],
      ['WC', 'Receipts', 'input', 'COLL', 690e6 / 4.33],
      ['WP', 'Disbursements', 'input', 'PAYM', 650e6 / 4.33],
      ['WB', 'Bank balances', 'input', 'CASH', 85e6, { bal: 1 }],
    ],
  };
  const DEV = {
    monthly: [
      ['H_R', 'Revenue', 'header'],
      ['RV_BK', 'Revenue recognised on bookings (POC)', 'input', 'REV_LOCAL', 380e6, { i: 1 }],
      ['RV_OS', 'Overseas Pakistani bookings', 'input', 'REV_EXPORT', 95e6, { i: 1 }],
      ['RV_TF', 'Transfer & processing fees', 'input', 'REV_OTHER', 9e6, { i: 1 }],
      ['RV_T', 'Total revenue', 'formula', 'RV_BK + RV_OS + RV_TF', 0, { bold: 1 }],
      ['H_C', 'Development cost', 'header'],
      ['DC_LD', 'Land cost allocated', 'input', 'COGS_MAT', 120e6, { i: 1 }],
      ['DC_CN', 'Construction & civil works', 'input', 'COGS_OH', 165e6, { i: 1 }],
      ['DC_SS', 'Site staff', 'input', 'COGS_LAB', 18e6, { i: 1 }],
      ['DC_T', 'Total development cost', 'formula', 'DC_LD + DC_CN + DC_SS', 0, { bold: 1 }],
      ['OP_MK', 'Marketing & launch events', 'input', 'OPEX_SELL', 22e6],
      ['OP_DC', 'Dealer commission', 'input', 'OPEX_SELL', 14e6],
      ['OP_AD', 'Head office expenses', 'input', 'OPEX_ADMIN', 17e6],
      ['OP_DP', 'Depreciation', 'input', 'DEP', 4e6],
      ['OP_TX', 'Income tax', 'input', 'TAX', 18e6],
      ['NET', 'Net profit for the month', 'formula', 'RV_T - DC_T - OP_MK - OP_DC - OP_AD - OP_DP - OP_TX', 0, { bold: 1 }],
      ['CS_IN', 'Instalments received', 'input', 'COLL', 430e6],
      ['CS_OUT', 'Payments to contractors & vendors', 'input', 'PAYM', 340e6],
      ['CS_BAL', 'Escrow + operating bank balance', 'input', 'CASH', 640e6, { bal: 1 }],
      ['CS_DUE', 'Instalments overdue', 'input', 'RECV', 260e6, { bal: 1 }],
      ['CS_WIP', 'Work in progress (inventory)', 'input', 'INV', 3900e6, { bal: 1 }],
      ['CS_PAY', 'Contractor payables', 'input', 'PAY', 210e6, { bal: 1 }],
      ['CS_HC', 'Staff strength', 'input', 'HC', 140, { bal: 1, int: 1 }],
      ['NEW_BK', 'New bookings (sale value)', 'input', 'ORDERS', 450e6],
    ],
    weekly: [
      ['WK_BK', 'New bookings (sale value)', 'input', 'ORDERS', 450e6 / 4.33],
      ['WK_IN', 'Instalments received', 'input', 'COLL', 430e6 / 4.33],
      ['WK_OUT', 'Contractor payments', 'input', 'PAYM', 340e6 / 4.33],
      ['WK_BAL', 'Bank balance', 'input', 'CASH', 640e6, { bal: 1 }],
    ],
  };
  const PROP = {
    monthly: [
      ['RENT', 'Rental income', 'input', 'REV_LOCAL', 62e6],
      ['SVC', 'Service charges recovered', 'input', 'REV_OTHER', 11e6],
      ['TOT', 'Gross income', 'formula', 'RENT + SVC', 0, { bold: 1 }],
      ['FM', 'Facility management', 'input', 'COGS_OH', 14e6],
      ['UTL', 'Utilities (common areas)', 'input', 'COGS_OH', 6e6],
      ['NOI', 'Net operating income', 'formula', 'TOT - FM - UTL', 0, { bold: 1 }],
      ['ADM', 'Admin & leasing', 'input', 'OPEX_ADMIN', 7e6],
      ['DEPR', 'Depreciation on investment property', 'input', 'DEP', 9e6],
      ['INT', 'Interest on loan', 'input', 'FIN', 8e6],
      ['TX', 'Tax', 'input', 'TAX', 6e6],
      ['RCV', 'Rent collected', 'input', 'COLL', 70e6],
      ['PMT', 'Payments', 'input', 'PAYM', 38e6],
      ['BNK', 'Bank', 'input', 'CASH', 95e6, { bal: 1 }],
      ['ARR', 'Rent arrears', 'input', 'RECV', 34e6, { bal: 1 }],
      ['LN', 'Term finance', 'input', 'DEBT', 620e6, { bal: 1 }],
      ['STF', 'Staff', 'input', 'HC', 46, { bal: 1, int: 1 }],
    ],
    weekly: [
      ['WR', 'Rent collected', 'input', 'COLL', 70e6 / 4.33],
      ['WB', 'Bank', 'input', 'CASH', 95e6, { bal: 1 }],
    ],
  };
  const DIGI = { // reports in USD
    monthly: [
      ['SUB', 'Subscription revenue (ARR/12)', 'input', 'REV_EXPORT', 410e3],
      ['PS', 'Professional services', 'input', 'REV_EXPORT', 120e3],
      ['LOC', 'Local enterprise contracts', 'input', 'REV_LOCAL', 60e3],
      ['TREV', 'Total revenue', 'formula', 'SUB + PS + LOC', 0, { bold: 1 }],
      ['HOST', 'Cloud hosting', 'input', 'COGS_OH', 62e3],
      ['DEL', 'Delivery team payroll', 'input', 'COGS_LAB', 150e3],
      ['TPL', 'Third-party licences', 'input', 'COGS_MAT', 25e3],
      ['GMG', 'Gross margin', 'formula', 'TREV - HOST - DEL - TPL', 0, { bold: 1 }],
      ['RND', 'R&D (expensed)', 'input', 'OPEX_OTHER', 55e3],
      ['SM', 'Sales & marketing', 'input', 'OPEX_SELL', 70e3],
      ['GA', 'G&A', 'input', 'OPEX_ADMIN', 48e3],
      ['EBD', 'EBITDA', 'formula', 'GMG - RND - SM - GA', 0, { bold: 1 }],
      ['DA', 'D&A', 'input', 'DEP', 9e3],
      ['TXS', 'Taxes', 'input', 'TAX', 6e3],
      ['CR', 'Cash received', 'input', 'COLL', 575e3],
      ['CP', 'Cash paid', 'input', 'PAYM', 470e3],
      ['CB', 'Cash balance', 'input', 'CASH', 1.6e6, { bal: 1 }],
      ['AR', 'Accounts receivable', 'input', 'RECV', 640e3, { bal: 1 }],
      ['AP', 'Accounts payable', 'input', 'PAY', 120e3, { bal: 1 }],
      ['FTE', 'FTEs', 'input', 'HC', 210, { bal: 1, int: 1 }],
      ['PIPE', 'New contract value signed', 'input', 'ORDERS', 640e3],
    ],
    weekly: [
      ['WBK', 'Bookings signed', 'input', 'ORDERS', 640e3 / 4.33],
      ['WCR', 'Cash received', 'input', 'COLL', 575e3 / 4.33],
      ['WCP', 'Cash paid', 'input', 'PAYM', 470e3 / 4.33],
      ['WCB', 'Cash balance', 'input', 'CASH', 1.6e6, { bal: 1 }],
    ],
  };
  const SOFT = {
    monthly: [
      ['REV1', 'Software licences & implementation', 'input', 'REV_LOCAL', 48e6],
      ['REV2', 'Support & AMC', 'input', 'REV_LOCAL', 19e6],
      ['COS1', 'Implementation team cost', 'input', 'COGS_LAB', 24e6],
      ['COS2', 'Hardware resold', 'input', 'COGS_MAT', 6e6],
      ['OPX1', 'Office & admin', 'input', 'OPEX_ADMIN', 9e6],
      ['OPX2', 'Business development', 'input', 'OPEX_SELL', 7e6],
      ['DEP1', 'Depreciation', 'input', 'DEP', 1.2e6],
      ['TAX1', 'Tax', 'input', 'TAX', 4e6],
      ['PROF', 'Profit', 'formula', 'REV1 + REV2 - COS1 - COS2 - OPX1 - OPX2 - DEP1 - TAX1', 0, { bold: 1 }],
      ['COLL1', 'Collections', 'input', 'COLL', 64e6],
      ['PAY1', 'Payments', 'input', 'PAYM', 52e6],
      ['CASH1', 'Cash at bank', 'input', 'CASH', 58e6, { bal: 1 }],
      ['AR1', 'Receivables', 'input', 'RECV', 72e6, { bal: 1 }],
      ['HC1', 'Headcount', 'input', 'HC', 120, { bal: 1, int: 1 }],
    ],
    weekly: [
      ['WCOL', 'Collections', 'input', 'COLL', 64e6 / 4.33],
      ['WCSH', 'Cash at bank', 'input', 'CASH', 58e6, { bal: 1 }],
    ],
  };
  const AGRI = {
    monthly: [
      ['FERT', 'Fertiliser sales', 'input', 'REV_LOCAL', 520e6],
      ['SEED', 'Seed sales', 'input', 'REV_LOCAL', 140e6],
      ['PEST', 'Pesticide sales', 'input', 'REV_LOCAL', 95e6],
      ['NETS', 'Net sales', 'formula', 'FERT + SEED + PEST', 0, { bold: 1 }],
      ['PUR', 'Purchases (net of stock movement)', 'input', 'COGS_MAT', 640e6],
      ['GPA', 'Gross profit', 'formula', 'NETS - PUR', 0, { bold: 1 }],
      ['DIST', 'Dealer incentives & freight', 'input', 'OPEX_SELL', 34e6],
      ['ADMN', 'Admin', 'input', 'OPEX_ADMIN', 15e6],
      ['MKUP', 'Markup', 'input', 'FIN', 21e6],
      ['DEPA', 'Depreciation', 'input', 'DEP', 3e6],
      ['TAXA', 'Tax', 'input', 'TAX', 9e6],
      ['RECA', 'Recoveries from dealers & farmers', 'input', 'COLL', 700e6],
      ['PAYA', 'Supplier payments', 'input', 'PAYM', 660e6],
      ['BNKA', 'Bank', 'input', 'CASH', 120e6, { bal: 1 }],
      ['DRA', 'Dealer receivables', 'input', 'RECV', 830e6, { bal: 1 }],
      ['STKA', 'Stock', 'input', 'INV', 410e6, { bal: 1 }],
      ['CRA', 'Supplier payables', 'input', 'PAY', 300e6, { bal: 1 }],
      ['LNA', 'Short-term finance', 'input', 'DEBT', 900e6, { bal: 1 }],
      ['HCA', 'Field force + staff', 'input', 'HC', 85, { bal: 1, int: 1 }],
    ],
    weekly: [
      ['WSAL', 'Sales (all products)', 'input', 'REV_LOCAL', 755e6 / 4.33],
      ['WREC', 'Recoveries', 'input', 'COLL', 700e6 / 4.33],
      ['WPAY', 'Supplier payments', 'input', 'PAYM', 660e6 / 4.33],
      ['WBNK', 'Bank', 'input', 'CASH', 120e6, { bal: 1 }],
    ],
  };

  const COMPANIES = [
    [TEX, 'JW-SPN', 'JW Spinning Mills Ltd', 'PKR', SPIN, 1.0, [3, 4, 5]],
    [TEX, 'JW-WVG', 'JW Weaving (Pvt) Ltd', 'PKR', WEAVE, 1.0, [3, 4, 5]],
    [TEX, 'JW-APP', 'JW Apparel (Pvt) Ltd', 'PKR', WEAVE, 0.55, [3, 4, 5]],
    [RE, 'JW-DEV', 'JW Developers (Pvt) Ltd', 'PKR', DEV, 1.0, [10, 11, 12]],
    [RE, 'JW-PRP', 'JW Properties (Pvt) Ltd', 'PKR', PROP, 1.0, []],
    [TECH, 'JW-DGT', 'JW Digital Inc.', 'USD', DIGI, 1.0, []],
    [TECH, 'JW-SFT', 'JW Software (Pvt) Ltd', 'PKR', SOFT, 1.0, [6]],
    [TRD_AG, 'JW-AGR', 'JW Agri Inputs (Pvt) Ltd', 'PKR', AGRI, 1.0, [10, 11, 2, 3]],
    [TRD, 'JW-TRD', 'JW Trading Company', 'PKR', AGRI, 0.4, [10, 11, 2, 3]],
  ];

  const insLine = db.prepare(`INSERT INTO company_lines(company_id, frequency, code, label, line_type, formula, head_id, sign, indent, bold, required, sort)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insSub = db.prepare("INSERT INTO submissions(company_id, frequency, period_key, status, revision, updated_by, updated_at) VALUES (?,?,?,?,?,?,?)");
  const insVal = db.prepare('INSERT INTO submission_values(submission_id, line_id, value) VALUES (?,?,?)');
  const insFiling = db.prepare(`INSERT INTO filings(submission_id, company_id, frequency, period_key, revision, currency, lines_json, heads_json, filed_by, filed_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);

  const nowMonth = P.lastClosed('monthly');
  const nowWeek = P.lastClosed('weekly');
  const months = P.series('monthly', nowMonth, 27);
  const weeks = P.series('weekly', nowWeek, 60);
  const companyIds = {};

  COMPANIES.forEach(([parent, code, name, ccy, fmt, scale, peakMonths], ci) => {
    const cid = node(parent, 'company', code, name, ccy, ci);
    companyIds[code] = cid;
    const growth = 1 + 0.004 + rand() * 0.012; // monthly growth
    for (const freq of ['monthly', 'weekly']) {
      const spec = fmt[freq];
      const lines = spec.map(([lcode, label, type, ref, base = 0, o = {}], i) => {
        const isFormula = type === 'formula';
        const info = insLine.run(cid, freq, lcode, label, type, isFormula ? ref : null,
          type === 'input' ? headId[ref] : null, 1, o.i || 0, o.bold ? 1 : 0, type === 'input' && i < 3 ? 1 : 0, (i + 1) * 10);
        return { id: Number(info.lastInsertRowid), code: lcode, label, line_type: type, formula: isFormula ? ref : null,
          head_id: type === 'input' ? headId[ref] : null, sign: 1, indent: o.i || 0, bold: o.bold ? 1 : 0, base: base * scale, o };
      });

      const keys = freq === 'monthly' ? months : weeks;
      keys.forEach((key, idx) => {
        // Leave the latest period partly unfiled so the status board has something to show
        const latest = idx === keys.length - 1;
        if (latest && ci === 1) return; // missing
        const draft = latest && ci === 6;
        const month = Number(P.monthOf(freq, key).slice(5));
        const season = peakMonths.includes(month) ? 1.22 : 1;
        const trend = Math.pow(growth, freq === 'monthly' ? idx - keys.length : (idx - keys.length) / 4.33);
        const values = new Map();
        for (const l of lines) {
          if (l.line_type !== 'input') continue;
          const noise = 1 + (rand() - 0.5) * (l.o.bal ? 0.06 : 0.16);
          let v = l.base * trend * noise * (l.o.bal ? 1 : season);
          v = l.o.int ? Math.round(v) : Math.round(v / 1000) * 1000;
          values.set(l.id, v);
        }
        const { start, end } = P.bounds(freq, key);
        const filedAt = new Date(end.getTime() + (2 + Math.floor(rand() * 5)) * 86400000).toISOString().replace('T', ' ').slice(0, 19);
        const subId = Number(insSub.run(cid, freq, key, draft ? 'draft' : 'filed', draft ? 0 : 1, null, filedAt).lastInsertRowid);
        for (const [lid, v] of values) insVal.run(subId, lid, v);
        if (draft) return;
        const computed = computeLines(lines, values);
        const snap = lines.map((l) => ({ id: l.id, code: l.code, label: l.label, line_type: l.line_type, formula: l.formula,
          head_id: l.head_id, sign: 1, indent: l.indent, bold: l.bold, value: l.line_type === 'header' ? null : computed.get(l.id) ?? null, note: null }));
        insFiling.run(subId, cid, freq, key, 1, ccy, JSON.stringify(snap), JSON.stringify(headTotalsFromLines(lines, computed)), null, filedAt);
        void start;
      });
    }
  });

  // ------------------------------------------------------------ fx (PKR per USD)
  const insFx = db.prepare('INSERT INTO fx_rates(currency, month_key, rate) VALUES (?,?,?)');
  months.forEach((m, i) => insFx.run('USD', m, Math.round((276 + i * 0.25 + (rand() - 0.5) * 2) * 100) / 100));

  // ------------------------------------------------------------ users
  const pw = (p) => bcrypt.hashSync(p, 10);
  const insUser = db.prepare('INSERT INTO users(name, email, password_hash, role, node_id) VALUES (?,?,?,?,?)');
  insUser.run('Group Finance Admin', 'admin@jwdash.local', pw('admin123'), 'admin', null);
  insUser.run('Group CEO', 'ceo@jwdash.local', pw('ceo123'), 'executive', null);
  insUser.run('Textiles Cluster Head', 'textiles@jwdash.local', pw('tex123'), 'cluster', TEX);
  insUser.run('Spinning Accountant', 'spinning@jwdash.local', pw('spin123'), 'company', companyIds['JW-SPN']);
  insUser.run('Developers Accountant', 'developers@jwdash.local', pw('dev123'), 'company', companyIds['JW-DEV']);
});

console.log('Seeded JW Group demo data.');
console.log('Logins: admin@jwdash.local / admin123 · ceo@jwdash.local / ceo123 · textiles@jwdash.local / tex123 · spinning@jwdash.local / spin123');
