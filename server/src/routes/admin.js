import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db, audit, getSettings, plain, plainAll } from '../db.js';
import { requireRole } from '../auth.js';
import { h, bad, notFound } from './util.js';

const r = Router();
const admin = requireRole('admin');

// ---- users
r.get('/users', admin, h(() => plainAll(db.prepare(`SELECT u.id, u.name, u.email, u.role, u.node_id, u.active, u.created_at,
  n.name AS node_name, n.type AS node_type FROM users u LEFT JOIN nodes n ON n.id = u.node_id ORDER BY u.role, u.name`).all())));

function checkUser(b) {
  const roles = ['admin', 'executive', 'cluster', 'company'];
  if (!roles.includes(b.role)) throw bad('Invalid role');
  if (!b.name || !b.email) throw bad('Name and email are required');
  if ((b.role === 'cluster' || b.role === 'company') && !b.node_id) throw bad('Pick the cluster or company this user belongs to');
  if (b.node_id) {
    const n = db.prepare('SELECT type FROM nodes WHERE id = ?').get(Number(b.node_id));
    if (!n) throw bad('Node not found');
    if (b.role === 'company' && n.type !== 'company') throw bad('A company user must be assigned to a company');
  }
}

r.post('/users', admin, h((req) => {
  const b = req.body || {};
  checkUser(b);
  if (!b.password || String(b.password).length < 6) throw bad('Password must be at least 6 characters');
  const info = db.prepare('INSERT INTO users(name, email, password_hash, role, node_id) VALUES (?,?,?,?,?)')
    .run(String(b.name).trim(), String(b.email).trim().toLowerCase(), bcrypt.hashSync(String(b.password), 10), b.role,
      b.node_id ? Number(b.node_id) : null);
  audit(req.user.id, 'user.create', 'user', Number(info.lastInsertRowid), { email: b.email, role: b.role });
  return { id: Number(info.lastInsertRowid) };
}));

r.put('/users/:id', admin, h((req) => {
  const id = Number(req.params.id);
  const cur = plain(db.prepare('SELECT * FROM users WHERE id = ?').get(id));
  if (!cur) throw notFound();
  const b = { ...cur, ...req.body };
  checkUser(b);
  if (id === req.user.id && (b.role !== 'admin' || !b.active)) throw bad('You cannot remove your own admin access');
  db.prepare('UPDATE users SET name=?, email=?, role=?, node_id=?, active=? WHERE id=?')
    .run(String(b.name).trim(), String(b.email).trim().toLowerCase(), b.role, b.node_id ? Number(b.node_id) : null, b.active ? 1 : 0, id);
  if (req.body.password) {
    if (String(req.body.password).length < 6) throw bad('Password must be at least 6 characters');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(String(req.body.password), 10), id);
  }
  audit(req.user.id, 'user.update', 'user', id, { role: b.role, active: b.active, password_reset: !!req.body.password });
  return { ok: true };
}));

// ---- settings
const EDITABLE = ['group_name', 'group_currency', 'fiscal_year_start_month', 'weekly_due_days', 'monthly_due_days'];
r.get('/settings', h(() => { const s = getSettings(); delete s.jwt_secret; return s; }));
r.put('/settings', admin, h((req) => {
  const b = req.body || {};
  const fy = Number(b.fiscal_year_start_month ?? 1);
  if (fy < 1 || fy > 12) throw bad('Fiscal year start month must be 1–12');
  if (b.group_currency) {
    const filed = db.prepare('SELECT COUNT(*) c FROM filings').get().c;
    const cur = getSettings().group_currency;
    if (filed && String(b.group_currency).toUpperCase() !== cur) throw bad('Group currency cannot change once figures are filed');
  }
  const up = db.prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const k of EDITABLE) if (b[k] != null) up.run(k, k === 'group_currency' ? String(b[k]).toUpperCase() : String(b[k]));
  audit(req.user.id, 'settings.update', 'settings', null, b);
  const s = getSettings(); delete s.jwt_secret; return s;
}));

// ---- fx
r.get('/fx', h(() => plainAll(db.prepare('SELECT * FROM fx_rates ORDER BY month_key DESC, currency').all())));
r.put('/fx', admin, h((req) => {
  const { currency, month_key, rate } = req.body || {};
  if (!/^[A-Z]{3}$/.test(String(currency || '').toUpperCase())) throw bad('Currency must be a 3-letter code');
  if (!/^\d{4}-\d{2}$/.test(month_key || '')) throw bad('Month must be YYYY-MM');
  if (!(Number(rate) > 0)) throw bad('Rate must be positive');
  db.prepare(`INSERT INTO fx_rates(currency, month_key, rate) VALUES (?,?,?)
    ON CONFLICT(currency, month_key) DO UPDATE SET rate = excluded.rate`).run(String(currency).toUpperCase(), month_key, Number(rate));
  audit(req.user.id, 'fx.set', 'fx', null, { currency, month_key, rate });
  return { ok: true };
}));
r.delete('/fx/:currency/:month', admin, h((req) => {
  db.prepare('DELETE FROM fx_rates WHERE currency = ? AND month_key = ?').run(req.params.currency, req.params.month);
  return { ok: true };
}));

// ---- audit
r.get('/audit', admin, h((req) => plainAll(db.prepare(`SELECT a.*, u.name AS user_name FROM audit a LEFT JOIN users u ON u.id = a.user_id
  ORDER BY a.id DESC LIMIT ?`).all(Math.min(Number(req.query.limit) || 200, 1000)))));

export default r;
