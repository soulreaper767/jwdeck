import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db, tx, audit, getSettings, plainAll } from '../db.js';
import { requireRole, ROLES } from '../auth.js';
import { h, bad, notFound } from './util.js';

const r = Router();
const admin = requireRole('admin');

// ---- users
r.get('/users', admin, h(() => {
  const users = plainAll(db.prepare('SELECT id, name, email, role, title, active, created_at FROM users ORDER BY role, name').all());
  const scopes = plainAll(db.prepare('SELECT s.user_id, n.id, n.name, n.type FROM user_scopes s JOIN nodes n ON n.id = s.node_id').all());
  return { roles: ROLES, users: users.map((u) => ({ ...u, scopes: scopes.filter((s) => s.user_id === u.id).map(({ user_id, ...n }) => n) })) };
}));

function check(b) {
  if (!ROLES[b.role]) throw bad('Invalid role');
  if (!String(b.name || '').trim() || !String(b.email || '').trim()) throw bad('Name and email are required');
  const scopes = (b.scopes || []).map((s) => Number(typeof s === 'object' ? s.id : s)).filter(Boolean);
  const types = scopes.map((id) => db.prepare('SELECT type FROM nodes WHERE id = ?').get(id)?.type);
  if (types.some((t) => !t)) throw bad('Unknown node in scope');
  if (['company_dpo', 'company_reviewer'].includes(b.role)) {
    if (!scopes.length) throw bad('Pick the company');
    if (types.some((t) => t !== 'company')) throw bad('Company roles can only be given companies');
  }
  if (b.role === 'cluster_reviewer') {
    if (!scopes.length) throw bad('Pick the cluster(s)');
    if (types.some((t) => t !== 'cluster')) throw bad('Cluster reviewers can only be given clusters');
  }
  return b.role === 'admin' ? [] : scopes;
}

function setScopes(uid, scopes) {
  db.prepare('DELETE FROM user_scopes WHERE user_id = ?').run(uid);
  const ins = db.prepare('INSERT INTO user_scopes(user_id, node_id) VALUES (?,?)');
  for (const s of new Set(scopes)) ins.run(uid, s);
}

r.post('/users', admin, h((req) => {
  const b = req.body || {};
  const scopes = check(b);
  if (!b.password || String(b.password).length < 6) throw bad('Password must be at least 6 characters');
  const id = tx(() => {
    const info = db.prepare('INSERT INTO users(name, email, password_hash, role, title) VALUES (?,?,?,?,?)')
      .run(String(b.name).trim(), String(b.email).trim().toLowerCase(), bcrypt.hashSync(String(b.password), 10), b.role, b.title || null);
    const uid = Number(info.lastInsertRowid);
    setScopes(uid, scopes);
    return uid;
  });
  audit(req.user.id, 'user.create', 'user', id, { email: b.email, role: b.role });
  return { id };
}));

r.put('/users/:id', admin, h((req) => {
  const id = Number(req.params.id);
  const cur = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!cur) throw notFound();
  const b = { ...cur, ...req.body };
  const scopes = check(b);
  if (id === req.user.id && (b.role !== 'admin' || !b.active)) throw bad('You cannot remove your own admin access');
  tx(() => {
    db.prepare('UPDATE users SET name=?, email=?, role=?, title=?, active=? WHERE id=?')
      .run(String(b.name).trim(), String(b.email).trim().toLowerCase(), b.role, b.title || null, b.active ? 1 : 0, id);
    setScopes(id, scopes);
    if (req.body.password) {
      if (String(req.body.password).length < 6) throw bad('Password must be at least 6 characters');
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(String(req.body.password), 10), id);
    }
  });
  audit(req.user.id, 'user.update', 'user', id, { role: b.role, active: b.active, password_reset: !!req.body.password });
  return { ok: true };
}));

// ---- settings
const EDITABLE = ['group_name', 'fiscal_year_start_month', 'week_due_days', 'month_due_days', 'week_cutoff_hour'];
r.get('/settings', h(() => { const s = getSettings(); delete s.jwt_secret; return s; }));
r.put('/settings', admin, h((req) => {
  const b = req.body || {};
  const fy = Number(b.fiscal_year_start_month ?? 7);
  if (fy < 1 || fy > 12) throw bad('Financial year start month must be 1–12');
  const up = db.prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const k of EDITABLE) if (b[k] != null) up.run(k, String(b[k]));
  audit(req.user.id, 'settings.update', 'settings', null, b);
  const s = getSettings(); delete s.jwt_secret; return s;
}));

// ---- audit
r.get('/audit', admin, h((req) => plainAll(db.prepare(`SELECT a.*, u.name AS user_name FROM audit a LEFT JOIN users u ON u.id = a.user_id
  ORDER BY a.id DESC LIMIT ?`).all(Math.min(Number(req.query.limit) || 200, 1000)))));

export default r;
