import { Router } from 'express';
import { db, audit, plain, plainAll } from '../db.js';
import { requireRole } from '../auth.js';
import { loadHeads, headOut } from '../consol.js';
import { validate, refs } from '../formula.js';
import { h, bad, notFound, bool } from './util.js';

const r = Router();

r.get('/heads', h((req) => {
  const all = req.query.all === '1';
  const model = loadHeads();
  const mapped = new Map(plainAll(db.prepare(
    'SELECT head_id, COUNT(DISTINCT company_id) n FROM company_lines WHERE active = 1 AND head_id IS NOT NULL GROUP BY head_id').all())
    .map((x) => [x.head_id, x.n]));
  const list = model.ordered.map((x) => ({ ...headOut(x), sort: x.sort, mapped_companies: mapped.get(x.id) || 0 }));
  if (all) {
    const inactive = plainAll(db.prepare('SELECT * FROM heads WHERE active = 0 ORDER BY sort').all());
    return [...list, ...inactive.map((x) => ({ ...x, depth: 0, mapped_companies: mapped.get(x.id) || 0 }))];
  }
  return list;
}));

function clean(b, existing = {}) {
  const v = { ...existing, ...b };
  const out = {
    parent_id: v.parent_id || null,
    code: String(v.code || '').trim().toUpperCase(),
    name: String(v.name || '').trim(),
    statement: v.statement || 'PL',
    head_type: v.head_type || 'input',
    nature: v.nature || 'flow',
    formula: v.head_type === 'formula' ? String(v.formula || '').trim().toUpperCase() : null,
    fmt: v.fmt || 'amount',
    higher_is_better: bool(v.higher_is_better ?? 1),
    frequency: v.frequency || 'both',
    is_kpi: bool(v.is_kpi),
    sort: Number(v.sort) || 0,
    active: v.active == null ? 1 : bool(v.active),
  };
  if (!/^[A-Z_][A-Z0-9_.]*$/.test(out.code)) throw bad('Code must start with a letter and use only A-Z, 0-9, _ or .');
  if (!out.name) throw bad('Name is required');
  if (out.head_type === 'formula') {
    if (!out.formula) throw bad('Formula is required for a formula head');
    const codes = new Set(plainAll(db.prepare('SELECT code FROM heads').all()).map((x) => x.code));
    codes.delete(out.code);
    validate(out.formula, codes);
    if (refs(out.formula).includes(out.code)) throw bad('A formula cannot reference itself');
  }
  return out;
}

function checkParent(id, parentId) {
  for (let p = parentId; p; p = db.prepare('SELECT parent_id FROM heads WHERE id = ?').get(p)?.parent_id) {
    if (p === id) throw bad('A head cannot be placed under itself');
  }
}

r.post('/heads', requireRole('admin'), h((req) => {
  const v = clean(req.body || {});
  const info = db.prepare(`INSERT INTO heads(parent_id, code, name, statement, head_type, nature, formula, fmt,
      higher_is_better, frequency, is_kpi, sort, active) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(v.parent_id, v.code, v.name, v.statement, v.head_type, v.nature, v.formula, v.fmt,
      v.higher_is_better, v.frequency, v.is_kpi, v.sort, v.active);
  audit(req.user.id, 'head.create', 'head', Number(info.lastInsertRowid), v);
  return plain(db.prepare('SELECT * FROM heads WHERE id = ?').get(info.lastInsertRowid));
}));

r.put('/heads/:id', requireRole('admin'), h((req) => {
  const id = Number(req.params.id);
  const cur = db.prepare('SELECT * FROM heads WHERE id = ?').get(id);
  if (!cur) throw notFound();
  const v = clean(req.body || {}, { ...cur });
  checkParent(id, v.parent_id);
  if (v.code !== cur.code) {
    const usedIn = plainAll(db.prepare("SELECT code, formula FROM heads WHERE head_type = 'formula'").all())
      .filter((x) => x.formula && refs(x.formula).includes(cur.code));
    if (usedIn.length) throw bad(`Code is used in formulas of: ${usedIn.map((x) => x.code).join(', ')}`);
  }
  if (v.head_type !== 'input' && cur.head_type === 'input') {
    const n = db.prepare('SELECT COUNT(*) c FROM company_lines WHERE head_id = ? AND active = 1').get(id).c;
    if (n) throw bad(`${n} company line(s) are mapped to this head. Remap them before changing its type.`);
  }
  db.prepare(`UPDATE heads SET parent_id=?, code=?, name=?, statement=?, head_type=?, nature=?, formula=?, fmt=?,
      higher_is_better=?, frequency=?, is_kpi=?, sort=?, active=? WHERE id=?`)
    .run(v.parent_id, v.code, v.name, v.statement, v.head_type, v.nature, v.formula, v.fmt,
      v.higher_is_better, v.frequency, v.is_kpi, v.sort, v.active, id);
  audit(req.user.id, 'head.update', 'head', id, v);
  return plain(db.prepare('SELECT * FROM heads WHERE id = ?').get(id));
}));

r.delete('/heads/:id', requireRole('admin'), h((req) => {
  const id = Number(req.params.id);
  const cur = db.prepare('SELECT * FROM heads WHERE id = ?').get(id);
  if (!cur) throw notFound();
  if (db.prepare('SELECT COUNT(*) c FROM heads WHERE parent_id = ?').get(id).c) throw bad('Move or delete its sub-heads first');
  if (db.prepare('SELECT COUNT(*) c FROM company_lines WHERE head_id = ?').get(id).c) throw bad('Company lines are mapped to this head. Deactivate it instead.');
  const usedIn = plainAll(db.prepare("SELECT code, formula FROM heads WHERE head_type = 'formula'").all())
    .filter((x) => x.formula && refs(x.formula).includes(cur.code));
  if (usedIn.length) throw bad(`Used in formulas of: ${usedIn.map((x) => x.code).join(', ')}`);
  const filed = plainAll(db.prepare('SELECT heads_json FROM filings').all()).some((f) => JSON.parse(f.heads_json)[id] != null);
  if (filed) throw bad('Filed figures reference this head. Deactivate it instead.');
  db.prepare('DELETE FROM heads WHERE id = ?').run(id);
  audit(req.user.id, 'head.delete', 'head', id, { code: cur.code });
  return { ok: true };
}));

export default r;
