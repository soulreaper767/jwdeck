import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { db } from './db.js';
import { loadTree, isWithin } from './consol.js';

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

export const sign = (user) => jwt.sign({ uid: user.id }, SECRET, { expiresIn: '12h' });

export function requireAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not signed in' });
  try {
    const { uid } = jwt.verify(token, SECRET);
    const u = db.prepare('SELECT id, name, email, role, node_id, active FROM users WHERE id = ?').get(uid);
    if (!u || !u.active) return res.status(401).json({ error: 'Account disabled' });
    req.user = { ...u };
    next();
  } catch {
    res.status(401).json({ error: 'Session expired' });
  }
}

export const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'Not permitted' });

// Root node a user is allowed to see (null = everything).
export function scopeRoot(user) {
  if (user.role === 'admin') return null;
  return user.node_id || null;
}

export function canView(user, nodeId, tree = loadTree()) {
  const root = scopeRoot(user);
  if (root == null) return user.role === 'admin' || user.role === 'executive';
  return isWithin(tree, root, Number(nodeId));
}

// Data entry rights: admins anywhere; company users inside their scope (company or cluster they own).
export function canEnter(user, companyId, tree = loadTree()) {
  if (user.role === 'admin') return true;
  if (user.role !== 'company' && user.role !== 'cluster') return false;
  return user.node_id != null && isWithin(tree, user.node_id, Number(companyId));
}
