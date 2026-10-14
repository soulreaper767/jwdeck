import { Router } from 'express';
import { db, tx, audit, plain, plainAll } from '../db.js';
import { requireRole, canView, canPrepare } from '../auth.js';
import { Engine, loadLines, loadSections, fyOf } from '../engine.js';
import * as P from '../periods.js';
import { h, bad, forbidden, notFound, num } from './util.js';

const r = Router();
const admin = requireRole('admin');

function company(id) {
  const c = db.prepare("SELECT * FROM nodes WHERE id = ? AND type = 'company'").get(Number(id));
  if (!c) throw notFound('Company not found');
  return { ...c };
}
const hasFilings = (cid) => !!db.prepare('SELECT COUNT(*) c FROM filings WHERE company_id = ?').get(cid).c;

// ------------------------------------------------------------ packs & lines

r.get('/lines', h(() => ({ sections: loadSections(), lines: loadLines({ all: true }) })));

r.put('/sections/:code', admin, h((req) => {
  const name = String(req.body?.name || '').trim();
  if (!name) throw bad('Name is required');
  db.prepare('UPDATE sections SET name = ? WHERE code = ?').run(name, req.params.code);
  audit(req.user.id, 'section.rename', 'section', null, { code: req.params.code, name });
  return { ok: true };
}));

r.put('/lines/:id', admin, h((req) => {
  const l = db.prepare('SELECT * FROM lines WHERE id = ?').get(Number(req.params.id));
  if (!l) throw notFound();
  const name = req.body?.name != null ? String(req.body.name).trim() : l.name;
  if (!name) throw bad('Name is required');
  const budget = req.body?.budget != null ? (req.body.budget ? 1 : 0) : l.budget;
  const active = req.body?.active != null ? (req.body.active ? 1 : 0) : l.active;
  if (l.system && !active) throw bad('Standard lines cannot be switched off');
  db.prepare('UPDATE lines SET name = ?, budget = ?, active = ? WHERE id = ?').run(name, l.kind === 'input' ? budget : 0, active, l.id);
  audit(req.user.id, 'line.update', 'line', l.id, { name, active });
  return { ok: true };
}));

// Extra input line under a total (e.g. another recovery or payment type)
r.post('/lines', admin, h((req) => {
  const parent = db.prepare("SELECT * FROM lines WHERE id = ? AND kind = 'sum'").get(Number(req.body?.parent_id));
  if (!parent) throw bad('Pick the total this line belongs to');
  const name = String(req.body?.name || '').trim();
  if (!name) throw bad('Name is required');
  const n = db.prepare('SELECT COUNT(*) c FROM lines').get().c + 1;
  const code = `${parent.code}_X${n}`;
  const sort = db.prepare('SELECT MAX(sort) s FROM lines WHERE parent_id = ?').get(parent.id).s || parent.sort - 5;
  // recoveries / payments need a cash-flow class so the monthly cash flow picks them up
  const sign = parent.code === 'REC_TOT' ? '+' : parent.code === 'PAY_TOT' ? '-' : null;
  const cls = ['OPS', 'INV', 'FIN'].includes(req.body?.cf) ? req.body.cf : 'OPS';
  db.prepare(`INSERT INTO lines(code, name, section, parent_id, kind, scope, cf, nature, fmt, hib, budget, sort)
    VALUES (?,?,?,?, 'input', ?, ?, 'flow', 'amount', ?, 1, ?)`).run(code, name, parent.section, parent.id, parent.scope, sign ? sign + cls : null, parent.hib, sort + 1);
  audit(req.user.id, 'line.create', 'line', null, { code, name });
  return { ok: true };
}));

// ------------------------------------------------------------ company setup: opening balance & SKUs

r.get('/companies/:id/setup', h((req) => {
  const c = company(req.params.id);
  if (!canView(req.user, c.id)) throw forbidden();
  const setup = plain(db.prepare('SELECT * FROM company_setup WHERE company_id = ?').get(c.id));
  const skus = plainAll(db.prepare('SELECT * FROM skus WHERE company_id = ? ORDER BY sort, id').all(c.id));
  const used = new Set(plainAll(db.prepare(`SELECT DISTINCT v.item FROM report_values v JOIN reports r ON r.id = v.report_id WHERE r.company_id = ?`).all(c.id))
    .map((x) => x.item));
  const filed = hasFilings(c.id);
  return {
    company: c, setup, filed,
    can_edit_opening: req.user.role === 'admin' || (canPrepare(req.user, c.id) && !filed),
    can_edit_skus: canPrepare(req.user, c.id),
    skus: skus.map((s) => ({ ...s, used: used.has(`SKU:${s.id}:PQ`) || used.has(`SKU:${s.id}:SQ`) || used.has(`SKU:${s.id}:SV`) })),
    suggested_start: P.lastClosedWeek(),
  };
}));

r.put('/companies/:id/setup', h((req) => {
  const c = company(req.params.id);
  const filed = hasFilings(c.id);
  if (!(req.user.role === 'admin' || (canPrepare(req.user, c.id) && !filed))) throw forbidden('Opening balance is locked once reporting has started');
  const start = String(req.body?.start_week || '');
  if (!P.isWeek(start)) throw bad('Pick the first reporting week');
  const opening = num(req.body?.opening_cash);
  if (opening == null) throw bad('Enter the opening cash & bank balance');
  if (filed) {
    const first = db.prepare('SELECT MIN(week_key) w FROM filings WHERE company_id = ?').get(c.id).w;
    if (start > first) throw bad(`Reports are already filed from ${first}`);
  }
  db.prepare(`INSERT INTO company_setup(company_id, start_week, opening_cash, updated_by) VALUES (?,?,?,?)
    ON CONFLICT(company_id) DO UPDATE SET start_week = excluded.start_week, opening_cash = excluded.opening_cash,
    updated_by = excluded.updated_by, updated_at = datetime('now')`).run(c.id, start, opening, req.user.id);
  audit(req.user.id, 'setup.opening', 'node', c.id, { start_week: start, opening_cash: opening });
  return { ok: true };
}));

r.put('/companies/:id/skus', h((req) => {
  const c = company(req.params.id);
  if (!canPrepare(req.user, c.id)) throw forbidden();
  const list = Array.isArray(req.body?.skus) ? req.body.skus : null;
  if (!list) throw bad('skus[] required');
  const seen = new Set();
  const clean = list.map((s, i) => {
    const name = String(s.name || '').trim();
    if (!name) throw bad(`Row ${i + 1}: name is required`);
    const code = String(s.code || name).trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || `SKU${i + 1}`;
    if (seen.has(code)) throw bad(`Duplicate code ${code}`);
    seen.add(code);
    return { id: s.id ? Number(s.id) : null, code, name, unit: String(s.unit || 'units').trim() || 'units', sort: (i + 1) * 10, active: s.active === 0 ? 0 : 1 };
  });
  tx(() => {
    const existing = plainAll(db.prepare('SELECT * FROM skus WHERE company_id = ?').all(c.id));
    const keep = new Set(clean.filter((s) => s.id).map((s) => s.id));
    db.prepare("UPDATE skus SET code = '__' || id WHERE company_id = ?").run(c.id);
    for (const x of existing) {
      if (keep.has(x.id)) continue;
      const used = db.prepare('SELECT COUNT(*) n FROM report_values WHERE item LIKE ?').get(`SKU:${x.id}:%`).n;
      if (used) db.prepare('UPDATE skus SET active = 0, code = ? WHERE id = ?').run(`${x.code}~${x.id}`, x.id);
      else { db.prepare('DELETE FROM skus WHERE id = ?').run(x.id); db.prepare('DELETE FROM budget_annual WHERE item LIKE ?').run(`SKU:${x.id}:%`); db.prepare('DELETE FROM budget_month WHERE item LIKE ?').run(`SKU:${x.id}:%`); }
    }
    for (const s of clean) {
      if (s.id && existing.some((x) => x.id === s.id)) db.prepare('UPDATE skus SET code=?, name=?, unit=?, sort=?, active=? WHERE id=?').run(s.code, s.name, s.unit, s.sort, s.active, s.id);
      else db.prepare('INSERT INTO skus(company_id, code, name, unit, sort, active) VALUES (?,?,?,?,?,?)').run(c.id, s.code, s.name, s.unit, s.sort, s.active);
    }
  });
  audit(req.user.id, 'setup.skus', 'node', c.id, { count: clean.length });
  return { ok: true };
}));

// ------------------------------------------------------------ budgets

r.get('/budgets/:id', h((req) => {
  const c = company(req.params.id);
  if (!canView(req.user, c.id)) throw forbidden();
  const eng = new Engine();
  const fy = Number(req.query.fy) || fyOf(P.monthOfDate(new Date()), eng.fyStartMonth);
  const months = P.fyAllMonths(fy, eng.fyStartMonth);
  const items = eng.budgetItems(c.id).map((k) => {
    const sku = /^SKU:\d+:(PQ|SQ|SV)$/.exec(k);
    const line = eng.m.byCode.get(k);
    return { key: k, label: eng.itemLabel(k), qty: (!!sku && sku[1] !== 'SV') || line?.fmt === 'number', section: line ? line.section : 'PRODSALES', scope: line ? line.scope : 'week' };
  });
  const annual = {};
  for (const b of plainAll(db.prepare('SELECT * FROM budget_annual WHERE company_id = ? AND fy = ?').all(c.id, fy))) annual[b.item] = b.value;
  const specific = {};
  for (const b of plainAll(db.prepare(`SELECT * FROM budget_month WHERE company_id = ? AND month_key IN (${months.map(() => '?').join(',')})`).all(c.id, ...months))) {
    (specific[b.item] ||= {})[b.month_key] = b.value;
  }
  const spread = {};
  for (const it of items) for (const mo of months) { const v = eng.budget(c.id, mo, it.key); if (v != null) (spread[it.key] ||= {})[mo] = v; }
  return {
    company: c, fy, fy_label: P.fyLabel(months[0], eng.fyStartMonth), months: months.map((m) => ({ key: m, label: P.monthLabel(m), days: P.daysInMonth(m) })),
    sections: eng.sections, items, annual, specific, spread,
    editable: req.user.role === 'admin' || canPrepare(req.user, c.id),
  };
}));

r.put('/budgets/:id', h((req) => {
  const c = company(req.params.id);
  if (!(req.user.role === 'admin' || canPrepare(req.user, c.id))) throw forbidden();
  const eng = new Engine();
  const fy = Number(req.body?.fy);
  if (!fy) throw bad('fy required');
  const months = P.fyAllMonths(fy, eng.fyStartMonth);
  const valid = new Set(eng.budgetItems(c.id));
  const annual = req.body?.annual || {};
  const specific = req.body?.specific || {};
  for (const [item, v] of Object.entries(annual)) {
    if (!valid.has(item) || v == null || v === '') continue;
    const spec = Object.values(specific[item] || {}).reduce((a, x) => a + (num(x) || 0), 0);
    if (Math.abs(spec) > Math.abs(num(v)) + 0.0001 && Math.sign(num(v)) !== 0) throw bad(`${eng.itemLabel(item)}: month-specific amounts exceed the annual total`);
  }
  tx(() => {
    db.prepare('DELETE FROM budget_annual WHERE company_id = ? AND fy = ?').run(c.id, fy);
    db.prepare(`DELETE FROM budget_month WHERE company_id = ? AND month_key IN (${months.map(() => '?').join(',')})`).run(c.id, ...months);
    const ia = db.prepare('INSERT INTO budget_annual(company_id, fy, item, value) VALUES (?,?,?,?)');
    const im = db.prepare('INSERT INTO budget_month(company_id, month_key, item, value) VALUES (?,?,?,?)');
    for (const [item, v] of Object.entries(annual)) if (valid.has(item) && num(v) != null) ia.run(c.id, fy, item, num(v));
    for (const [item, byM] of Object.entries(specific)) {
      if (!valid.has(item)) continue;
      for (const [mo, v] of Object.entries(byM || {})) if (months.includes(mo) && num(v) != null && num(v) !== 0) im.run(c.id, mo, item, num(v));
    }
  });
  audit(req.user.id, 'budget.save', 'node', c.id, { fy });
  return { ok: true };
}));

export default r;
