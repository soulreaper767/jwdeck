// Hub side of sync: desktops pull changed documents by sequence number and push their own changes.
import { Router } from 'express';
import { db, tx, plainAll } from '../db.js';
import { canView, canPrepare, isGlobal, signLong } from '../auth.js';
import { loadTree } from '../engine.js';
import { listKeys, getDoc, applyDoc, hashOf, mergeReport, companyOf, PUSHABLE } from './docs.js';
import { h, bad } from '../routes/util.js';

db.exec(`CREATE TABLE IF NOT EXISTS hub_docs (
  type TEXT NOT NULL, key TEXT NOT NULL, hash TEXT NOT NULL, seq INTEGER NOT NULL,
  PRIMARY KEY (type, key)
);`);

// Give every changed document a new sequence number
export function stamp() {
  return tx(() => {
    let seq = db.prepare('SELECT COALESCE(MAX(seq), 0) s FROM hub_docs').get().s;
    const cur = new Map(plainAll(db.prepare('SELECT type, key, hash FROM hub_docs').all()).map((r) => [`${r.type}|${r.key}`, r.hash]));
    const up = db.prepare('INSERT INTO hub_docs(type, key, hash, seq) VALUES (?,?,?,?) ON CONFLICT(type, key) DO UPDATE SET hash = excluded.hash, seq = excluded.seq');
    for (const { type, key } of listKeys()) {
      const hsh = hashOf(getDoc(type, key));
      if (cur.get(`${type}|${key}`) !== hsh) up.run(type, key, hsh, ++seq);
    }
    return seq;
  });
}

function visible(user, tree, type, key, codeToId) {
  if (type === 'config' || type === 'node' || type === 'users') return true;
  const id = codeToId.get(companyOf(type, key));
  return !!id && canView(user, id, tree);
}

// Users a desktop may hold for offline sign-in: the people working on what this user can see
function usersFor(user, tree, all) {
  if (isGlobal(user)) return all;
  const codeToId = new Map([...tree.byId.values()].map((n) => [n.code, n.id]));
  return all.filter((u) => u.email === user.email.toLowerCase() || (u.scopes.length && u.scopes.every((c) => canView(user, codeToId.get(c), tree))));
}

const r = Router();

r.post('/sync/token', h((req) => ({ token: signLong(req.user), email: req.user.email })));

r.get('/sync/pull', h((req) => {
  const since = Number(req.query.since) || 0;
  const seq = stamp();
  const tree = loadTree();
  const codeToId = new Map([...tree.byId.values()].map((n) => [n.code, n.id]));
  const rows = plainAll(db.prepare('SELECT type, key, hash, seq FROM hub_docs WHERE seq > ? ORDER BY seq').all(since));
  const order = { config: 0, node: 1, users: 2, skus: 3, setup: 4, budget: 5, week: 6, month: 7 };
  const nodeDepth = (code) => { let d = 0; for (let n = tree.byId.get(codeToId.get(code)); n?.parent_id; n = tree.byId.get(n.parent_id)) d++; return d; };
  const docs = rows.filter((x) => visible(req.user, tree, x.type, x.key, codeToId))
    .sort((a, b) => (order[a.type] - order[b.type]) || (a.type === 'node' ? nodeDepth(a.key) - nodeDepth(b.key) : a.seq - b.seq))
    .map((x) => {
      let payload = getDoc(x.type, x.key);
      if (x.type === 'users') payload = usersFor(req.user, tree, payload);
      return { type: x.type, key: x.key, seq: x.seq, hash: x.type === 'users' ? hashOf(payload) : x.hash, payload };
    });
  return { seq, docs };
}));

r.post('/sync/push', h((req) => {
  const docs = Array.isArray(req.body?.docs) ? req.body.docs : null;
  if (!docs) throw bad('docs[] required');
  const tree = loadTree();
  const codeToId = new Map([...tree.byId.values()].map((n) => [n.code, n.id]));
  const results = [];
  for (const d of docs) {
    const { type, key, base, payload } = d;
    try {
      if (!PUSHABLE.has(type)) throw new Error('Not accepted from desktops');
      const cid = codeToId.get(companyOf(type, key));
      if (!cid) throw new Error('Unknown company');
      const editor = type === 'week' || type === 'month' ? canView(req.user, cid, tree) && req.user.role !== 'executive' : canPrepare(req.user, cid, tree);
      if (!editor) throw new Error('Not permitted');
      const cur = getDoc(type, key);
      const curHash = hashOf(cur);
      let next = payload;
      if (cur && curHash !== base && (type === 'week' || type === 'month')) {
        const m = mergeReport(cur, payload);
        if (m.reject) { results.push({ type, key, status: 'conflict', hash: curHash, payload: cur }); continue; }
        next = m.doc;
      }
      applyDoc(type, key, next);
      const after = getDoc(type, key);
      results.push({ type, key, status: hashOf(after) === hashOf(payload) ? 'ok' : 'merged', hash: hashOf(after), payload: after });
    } catch (e) {
      results.push({ type, key, status: 'error', error: e.message });
    }
  }
  stamp();
  return { results };
}));

r.get('/sync/info', h((req) => ({ mode: 'hub', user: req.user.email })));

export default r;
