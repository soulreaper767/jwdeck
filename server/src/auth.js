import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { db } from './db.js';
import { loadTree, isWithin } from './engine.js';

function secret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  let r = db.prepare("SELECT value FROM settings WHERE key = 'jwt_secret'").get();
  if (!r) {
    const s = crypto.randomBytes(48).toString('hex');
    db.prepare("INSERT INTO settings(key, value) VALUES ('jwt_secret', ?)").run(s);
    r = { value: s };
  }
  return r.value;
}
const SECRET = secret();

export const ROLES = {
  admin: 'Administrator',
  executive: 'Executive (view)',
  group_reviewer: 'Group reviewer',
  cluster_reviewer: 'Cluster reviewer',
  company_reviewer: 'Company reviewer',
  company_dpo: 'Company DPO',
};

export const sign = (user) => jwt.sign({ uid: user.id }, SECRET, { expiresIn: '12h' });
// long-lived token a desktop install uses for background sync
export const signLong = (user) => jwt.sign({ uid: user.id, sync: 1 }, SECRET, { expiresIn: '365d' });

export function loadUser(id) {
  const u = db.prepare('SELECT id, name, email, role, title, active FROM users WHERE id = ?').get(id);
  if (!u) return null;
  return { ...u, scopes: db.prepare('SELECT node_id FROM user_scopes WHERE user_id = ?').all(id).map((r) => r.node_id) };
}

export function requireAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not signed in' });
  try {
    const { uid } = jwt.verify(token, SECRET);
    const u = loadUser(uid);
    if (!u || !u.active) return res.status(401).json({ error: 'Account disabled' });
    req.user = u;
    next();
  } catch {
    res.status(401).json({ error: 'Session expired' });
  }
}

export const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'Not permitted' });

// Group-wide users see everything
export const isGlobal = (u) => u.role === 'admin' || (['group_reviewer', 'executive'].includes(u.role) && !u.scopes.length);

// Top nodes the user may open
export function scopeRoots(u, tree = loadTree()) {
  return isGlobal(u) ? tree.roots.map((r) => r.id) : u.scopes.filter((id) => tree.byId.has(id));
}

export function canView(u, nodeId, tree = loadTree()) {
  if (isGlobal(u)) return true;
  return u.scopes.some((s) => isWithin(tree, s, Number(nodeId)));
}

// Prepare / submit figures
export function canPrepare(u, cid, tree = loadTree()) {
  if (u.role === 'admin') return true;
  return u.role === 'company_dpo' && canView(u, cid, tree);
}

// Workflow: who acts at each stage
export const NEXT = { submitted: 'company_ok', company_ok: 'cluster_ok', cluster_ok: 'approved' };
const STAGE_ROLE = { submitted: 'company_reviewer', company_ok: 'cluster_reviewer', cluster_ok: 'group_reviewer' };

// Reopening (sending back for entry) is reserved for the group reviewer and admin
const REOPENABLE = new Set(['submitted', 'company_ok', 'cluster_ok', 'approved', 'lapsed']);
export function actions(u, cid, status, tree = loadTree()) {
  const out = [];
  if (NEXT[status] && (u.role === 'admin' || (STAGE_ROLE[status] === u.role && canView(u, cid, tree)))) out.push('approve');
  if (REOPENABLE.has(status) && (u.role === 'admin' || u.role === 'group_reviewer')) out.push('reopen');
  return out;
}
