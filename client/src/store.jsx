import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, getToken, setToken } from './lib/api.js';

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

const VKEY = 'jwdash.v2';
const loadView = () => { try { return JSON.parse(localStorage.getItem(VKEY)) || {}; } catch { return {}; } };

export function AppProvider({ children }) {
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(!!getToken());
  const [tree, setTree] = useState([]);
  const [periods, setPeriods] = useState(null);
  const [toast, setToast] = useState(null);
  const [view, setViewState] = useState(() => ({ nodeId: null, week: null, month: null, unit: 'm', ...loadView() }));

  const notify = useCallback((msg, kind) => setToast({ msg, kind, id: Date.now() }), []);
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), toast.kind === 'err' ? 6000 : 2500);
    return () => clearTimeout(t);
  }, [toast]);

  const setView = useCallback((patch) => setViewState((v) => {
    const n = { ...v, ...patch };
    localStorage.setItem(VKEY, JSON.stringify(n));
    return n;
  }), []);

  const loadTree = useCallback(async () => { const t = await api.get('/tree'); setTree(t); return t; }, []);

  useEffect(() => {
    const out = () => setUser(null);
    window.addEventListener('jwdash:logout', out);
    if (getToken()) api.get('/auth/me').then(setUser).catch(() => setToken(null)).finally(() => setBooting(false));
    return () => window.removeEventListener('jwdash:logout', out);
  }, []);
  useEffect(() => {
    if (!user) return;
    loadTree().catch(() => {});
    api.get('/periods').then(setPeriods).catch(() => {});
  }, [user, loadTree]);

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
  const logout = () => { setToken(null); setUser(null); setTree([]); };

  const canEnter = (cid) => {
    if (!user) return false;
    if (user.role === 'admin') return true;
    if (user.role !== 'company' && user.role !== 'cluster') return false;
    for (let n = nodes.get(cid); n; n = n.parent) if (n.id === user.node_id) return true;
    return false;
  };

  return (
    <Ctx.Provider value={{
      user, booting, login, logout, tree, nodes, loadTree, periods, notify, canEnter,
      view: { ...view, nodeId, week }, setView, isAdmin: user?.role === 'admin',
    }}>
      {children}
      {toast && <div key={toast.id} className={`toast ${toast.kind === 'err' ? 'err' : ''}`}>{toast.msg}</div>}
    </Ctx.Provider>
  );
}
