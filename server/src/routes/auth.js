import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db, getSettings } from '../db.js';
import { sign, requireAuth, loadUser, ROLES, isGlobal } from '../auth.js';
import { loadTree } from '../engine.js';
import { h, bad } from './util.js';

const r = Router();

function publicSettings() {
  const s = getSettings();
  delete s.jwt_secret;
  return s;
}

function profile(u) {
  const tree = loadTree();
  const full = loadUser(u.id);
  return {
    id: full.id, name: full.name, email: full.email, role: full.role, role_label: ROLES[full.role], title: full.title,
    scopes: full.scopes.map((id) => ({ id, name: tree.byId.get(id)?.name, type: tree.byId.get(id)?.type })),
    global: isGlobal(full),
    settings: publicSettings(),
  };
}

r.post('/login', h((req) => {
  const { email, password } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').trim());
  if (!u || !u.active || !bcrypt.compareSync(String(password || ''), u.password_hash)) throw bad('Invalid email or password');
  return { token: sign(u), user: profile(u) };
}));

r.get('/me', requireAuth, h((req) => profile(req.user)));

r.post('/password', requireAuth, h((req) => {
  const { current, next } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(String(current || ''), u.password_hash)) throw bad('Current password is wrong');
  if (!next || String(next).length < 6) throw bad('New password must be at least 6 characters');
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(String(next), 10), u.id);
  return { ok: true };
}));

export default r;
