import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, getToken, setToken } from './lib/api.js';

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

const VKEY = 'jwdash.v3';
const loadView = () => { try { return JSON.parse(localStorage.getItem(VKEY)) || {}; } catch { return {}; } };

export function AppProvider({ children }) {
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(!!getToken());
  const [tree, setTree] = useState([]);
  const [periods, setPeriods] = useState(null);
  const [toast, setToast] = useState(null);
  const [inbox, setInbox] = useState(null);
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const [sync, setSync] = useState(null);
  const [view, setViewState] = useState(() => ({ nodeId: null, week: null, month: null, unit: 'm', ...loadView() }));

  const notify = useCallback((msg, kind) => setToast({ msg, kind, id: Date.now() }), []);
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), toast.kind === 'err' ? 6000 : 2500);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  const setView = useCallback((patch) => setViewState((v) => {
    const n = { ...v, ...patch };
    try { localStorage.setItem(VKEY, JSON.stringify(n)); } catch { /* ignore */ }
    return n;
  }), []);

  const loadTree = useCallback(async () => { const t = await api.get('/tree'); setTree(t); return t; }, []);
  const loadInbox = useCallback(() => api.get('/inbox').then(setInbox).catch(() => {}), []);

  useEffect(() => {
    const out = () => setUser(null);
    window.addEventListener('jwdash:logout', out);
    if (getToken()) api.get('/auth/me').then(setUser).catch(() => setToken(null)).finally(() => setBooting(false));
    return () => window.removeEventListener('jwdash:logout', out);
  }, []);
  useEffect(() => {
    let t;
    const poll = () => api.get('/sync/status').then((s) => { setSync(s); if (s.mode === 'node') t = setTimeout(poll, 8000); }).catch(() => {});
    poll();
    return () => clearTimeout(t);
  }, []);
  const syncNow = useCallback(async () => { try { setSync({ ...(await api.post('/sync/now')), mode: 'node', connected: true }); } catch { /* shown via status */ } }, []);
  useEffect(() => {
    if (!user) return;
    loadTree().catch(() => {});
    api.get('/periods').then(setPeriods).catch(() => {});
    loadInbox();
  }, [user, loadTree, loadInbox]);

  const nodes = useMemo(() => {
    const map = new Map();
    const walk = (n, parent, depth) => { map.set(n.id, { ...n, parent, depth }); n.children.forEach((c) => walk(c, n, depth + 1)); };
    tree.forEach((r) => walk(r, null, 0));
    return map;
  }, [tree]);

  const nodeId = view.nodeId && nodes.has(view.nodeId) ? view.nodeId : tree[0]?.id || null;
  const week = view.week || periods?.last_closed || null;

  const login = async (email, password) => {
    const r = await api.post('/auth/login', { email, password });
    setToken(r.token);
    setUser(r.user);
  };
  const logout = () => { setToken(null); setUser(null); setTree([]); setInbox(null); };

  const inScope = (cid) => {
    if (!user) return false;
    if (user.global) return true;
    for (let n = nodes.get(cid); n; n = n.parent) if (user.scopes.some((s) => s.id === n.id)) return true;
    return false;
  };
  const canPrepare = (cid) => !!user && (user.role === 'admin' || (user.role === 'company_dpo' && inScope(cid)));

  return (
    <Ctx.Provider value={{
      user, booting, login, logout, tree, nodes, loadTree, periods, notify, canPrepare, inbox, loadInbox, online, sync, syncNow,
      view: { ...view, nodeId, week }, setView, isAdmin: user?.role === 'admin',
    }}>
      {children}
      {toast && <div key={toast.id} className={`toast ${toast.kind === 'err' ? 'err' : ''}`}>{toast.msg}</div>}
    </Ctx.Provider>
  );
}
