// Desktop side of sync: push local changes, then pull everything new from the hub. Runs every 30 s and
// shortly after any local change. Works fully offline in between.
import { Router } from 'express';
import { db, tx, plainAll, getSettings, audit } from '../db.js';
import { requireAuth } from '../auth.js';
import { listKeys, getDoc, applyDoc, hashOf, PUSHABLE } from './docs.js';
import { state, isNode } from './state.js';
import { h, bad } from '../routes/util.js';

db.exec(`CREATE TABLE IF NOT EXISTS node_docs (type TEXT NOT NULL, key TEXT NOT NULL, hash TEXT NOT NULL, PRIMARY KEY (type, key));
CREATE TABLE IF NOT EXISTS sync_conflicts (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT, key TEXT, local_json TEXT, at TEXT NOT NULL DEFAULT (datetime('now')));`);

const setting = (k) => getSettings()[k] || null;
const setSetting = (k, v) => db.prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, v == null ? null : String(v));
const known = () => new Map(plainAll(db.prepare('SELECT type, key, hash FROM node_docs').all()).map((r) => [`${r.type}|${r.key}`, r.hash]));
const setKnown = (type, key, hash) => db.prepare('INSERT INTO node_docs(type, key, hash) VALUES (?,?,?) ON CONFLICT(type, key) DO UPDATE SET hash = excluded.hash').run(type, key, hash);

async function call(method, path, body, { hub = setting('sync_hub'), token = setting('sync_token'), timeout = 20000 } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(`${hub.replace(/\/$/, '')}${path}`, {
      method, signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(data.error || `Hub error ${res.status}`); e.status = res.status; throw e; }
    return data;
  } finally { clearTimeout(t); }
}

function pendingDocs() {
  const k = known();
  const out = [];
  for (const { type, key } of listKeys()) {
    if (!PUSHABLE.has(type)) continue;
    const payload = getDoc(type, key);
    const hash = hashOf(payload);
    const base = k.get(`${type}|${key}`) || null;
    if (hash !== base) out.push({ type, key, base, payload });
  }
  return out;
}

export async function cycle() {
  if (!isNode() || state.running || !setting('sync_hub') || !setting('sync_token')) return;
  state.running = true;
  try {
    // 1. push local changes
    const out = pendingDocs();
    for (let i = 0; i < out.length; i += 100) {
      const { results } = await call('POST', '/api/sync/push', { docs: out.slice(i, i + 100) });
      for (const r of results) {
        if (r.status === 'error') { state.lastError = `${r.type} ${r.key}: ${r.error}`; continue; }
        if (r.status === 'conflict') {
          const mine = out.find((x) => x.type === r.type && x.key === r.key);
          db.prepare('INSERT INTO sync_conflicts(type, key, local_json) VALUES (?,?,?)').run(r.type, r.key, JSON.stringify(mine?.payload ?? null));
          state.conflicts += 1;
        }
        if (r.status !== 'ok') applyDoc(r.type, r.key, r.payload);
        setKnown(r.type, r.key, r.hash);
      }
    }
    // 2. pull everything new
    const since = Number(setting('sync_seq') || 0);
    const pulled = await call('GET', `/api/sync/pull?since=${since}`);
    tx(() => {
      for (const d of pulled.docs) {
        if (hashOf(getDoc(d.type, d.key)) !== d.hash) applyDoc(d.type, d.key, d.payload);
        setKnown(d.type, d.key, d.hash);
      }
      setSetting('sync_seq', pulled.seq);
    });
    state.online = true;
    state.lastSync = new Date().toISOString();
    if (!out.length || !state.lastError?.includes(':')) state.lastError = null;
  } catch (e) {
    state.online = false;
    state.lastError = e.name === 'AbortError' || e.cause ? 'Hub not reachable' : e.message;
    if (e.status === 401) state.lastError = 'Sign-in to hub expired. Reconnect from Settings.';
  } finally {
    try { state.pending = pendingDocs().length; } catch { /* ignore */ }
    state.running = false;
  }
}

let timer = null;
export function schedule(ms = 1500) {
  if (!isNode()) return;
  clearTimeout(timer);
  timer = setTimeout(cycle, ms);
}
export function start() {
  if (!isNode()) return;
  setInterval(cycle, 30000);
  schedule(500);
}

// ---------------------------------------------------------------- routes (desktop only)
const r = Router();

r.get('/sync/status', h(() => ({
  mode: isNode() ? 'node' : 'hub',
  connected: !!setting('sync_token'), hub: setting('sync_hub'), email: setting('sync_email'),
  ...state,
})));

// First run: link this desktop to the hub with a user's credentials, then download their data
// reconnecting an install that is already linked requires a signed-in user of this install
const firstRunOrAuth = (req, res, next) => (db.prepare('SELECT COUNT(*) c FROM users').get().c > 0 && setting('sync_token') ? requireAuth(req, res, next) : next());

r.post('/sync/connect', firstRunOrAuth, h(async (req) => {
  if (!isNode()) throw bad('Only desktop installs connect to a hub');
  const hub = String(req.body?.hub || '').trim().replace(/\/$/, '');
  const email = String(req.body?.email || '').trim();
  if (!/^https?:\/\//.test(hub)) throw bad('Hub address must start with http:// or https://');
  let login;
  try { login = await call('POST', '/api/auth/login', { email, password: req.body?.password }, { hub, token: null, timeout: 15000 }); } catch (e) { throw bad(e.status ? e.message : 'Hub not reachable'); }
  const { token } = await call('POST', '/api/sync/token', {}, { hub, token: login.token });
  if (setting('sync_hub') && setting('sync_hub') !== hub) { db.exec('DELETE FROM node_docs'); setSetting('sync_seq', 0); }
  setSetting('sync_hub', hub);
  setSetting('sync_token', token);
  setSetting('sync_email', email.toLowerCase());
  if (!setting('sync_seq')) setSetting('sync_seq', 0);
  await cycle();
  if (!state.online) throw bad(state.lastError || 'Sync failed');
  audit(null, 'sync.connect', 'settings', null, { hub, email });
  return { ok: true };
}));

r.post('/sync/now', requireAuth, h(async () => { await cycle(); return state; }));

export default r;
