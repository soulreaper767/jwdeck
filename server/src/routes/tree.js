import { Router } from 'express';
import { db, audit, plain } from '../db.js';
import { requireRole, scopeRoot } from '../auth.js';
import { loadTree, isWithin } from '../consol.js';
import { h, bad, notFound } from './util.js';

const r = Router();

const ALLOWED_PARENT = { group: [null], cluster: ['group', 'cluster'], company: ['group', 'cluster'] };

function strip(n) {
  const { children, ...rest } = n;
  return { ...rest, meta: JSON.parse(rest.meta || '{}'), children: children.map(strip) };
}

r.get('/tree', h((req) => {
  const tree = loadTree();
  const root = scopeRoot(req.user);
  if (root == null) {
    if (req.user.role !== 'admin' && req.user.role !== 'executive') return [];
    return tree.roots.map(strip);
  }
  const n = tree.byId.get(root);
  return n ? [strip(n)] : [];
}));

function checkPlacement(tree, type, parentId, selfId) {
  const parent = parentId ? tree.byId.get(Number(parentId)) : null;
  if (parentId && !parent) throw bad('Parent not found');
  if (!ALLOWED_PARENT[type]) throw bad('Invalid type');
  if (!ALLOWED_PARENT[type].includes(parent ? parent.type : null)) {
    throw bad(type === 'group' ? 'A group must be the top of the tree'
      : `A ${type} must sit under a group or cluster`);
  }
  if (selfId && parent && isWithin(tree, Number(selfId), parent.id)) throw bad('Cannot move a node under itself');
  if (type === 'group' && !selfId && tree.roots.some((x) => x.type === 'group')) throw bad('Only one group root is allowed');
}

r.post('/nodes', requireRole('admin'), h((req) => {
  const { parent_id = null, type, code, name, currency = 'PKR', sort = 0, meta = {} } = req.body || {};
  if (!code || !name) throw bad('Code and name are required');
  checkPlacement(loadTree(), type, parent_id, null);
  const info = db.prepare('INSERT INTO nodes(parent_id, type, code, name, currency, sort, meta) VALUES (?,?,?,?,?,?,?)')
    .run(parent_id || null, type, String(code).trim().toUpperCase(), String(name).trim(),
      String(currency).trim().toUpperCase(), Number(sort) || 0, JSON.stringify(meta || {}));
  audit(req.user.id, 'node.create', 'node', Number(info.lastInsertRowid), { code, name, type });
  return plain(db.prepare('SELECT * FROM nodes WHERE id = ?').get(info.lastInsertRowid));
}));

r.put('/nodes/:id', requireRole('admin'), h((req) => {
  const id = Number(req.params.id);
  const cur = db.prepare('SELECT * FROM nodes WHERE id = ?').get(id);
  if (!cur) throw notFound();
  const b = req.body || {};
  const next = {
    parent_id: b.parent_id !== undefined ? (b.parent_id || null) : cur.parent_id,
    code: b.code != null ? String(b.code).trim().toUpperCase() : cur.code,
    name: b.name != null ? String(b.name).trim() : cur.name,
    currency: b.currency != null ? String(b.currency).trim().toUpperCase() : cur.currency,
    sort: b.sort != null ? Number(b.sort) || 0 : cur.sort,
    active: b.active != null ? (b.active ? 1 : 0) : cur.active,
    meta: b.meta != null ? JSON.stringify(b.meta) : cur.meta,
  };
  if (next.parent_id !== cur.parent_id) checkPlacement(loadTree(), cur.type, next.parent_id, id);
  if (next.currency !== cur.currency && cur.type === 'company') {
    const used = db.prepare('SELECT COUNT(*) c FROM filings WHERE company_id = ?').get(id).c;
    if (used) throw bad('Currency cannot change after figures have been filed');
  }
  db.prepare('UPDATE nodes SET parent_id=?, code=?, name=?, currency=?, sort=?, active=?, meta=? WHERE id=?')
    .run(next.parent_id, next.code, next.name, next.currency, next.sort, next.active, next.meta, id);
  audit(req.user.id, 'node.update', 'node', id, b);
  return plain(db.prepare('SELECT * FROM nodes WHERE id = ?').get(id));
}));

r.delete('/nodes/:id', requireRole('admin'), h((req) => {
  const id = Number(req.params.id);
  if (db.prepare('SELECT COUNT(*) c FROM nodes WHERE parent_id = ?').get(id).c) throw bad('Remove or move its children first');
  if (db.prepare('SELECT COUNT(*) c FROM submissions WHERE company_id = ?').get(id).c) {
    throw bad('This company has figures on record. Deactivate it instead.');
  }
  if (db.prepare('SELECT COUNT(*) c FROM users WHERE node_id = ?').get(id).c) throw bad('Users are assigned to this node');
  db.prepare('DELETE FROM company_lines WHERE company_id = ?').run(id);
  db.prepare('DELETE FROM nodes WHERE id = ?').run(id);
  audit(req.user.id, 'node.delete', 'node', id);
  return { ok: true };
}));

export default r;
