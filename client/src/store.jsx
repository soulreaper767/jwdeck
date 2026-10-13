import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, getToken, setToken } from './lib/api.js';

const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

const VIEW_KEY = 'jwdash.view';
const loadView = () => {
  try { return JSON.parse(localStorage.getItem(VIEW_KEY)) || {}; } catch { return {}; }
};

export function AppProvider({ children }) {
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(!!getToken());
  const [tree, setTree] = useState([]);
  const [toast, setToast] = useState(null);
  const [view, setViewState] = useState(() => ({ freq: 'monthly', mode: 'period', scale: 'M', nodeId: null, key: null, lfl: true, ...loadView() }));

  const notify = useCallback((msg, kind = 'ok') => {
    setToast({ msg, kind, id: Date.now() });
  }, []);
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), toast.kind === 'err' ? 6000 : 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const setView = useCallback((patch) => {
    setViewState((v) => {
      const next = { ...v, ...patch };
      if (patch.freq && patch.freq !== v.freq) {
        next.key = null;
        next.mode = 'period';
      }
      localStorage.setItem(VIEW_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const loadTree = useCallback(async () => {
    const t = await api.get('/tree');
    setTree(t);
    return t;
  }, []);

  useEffect(() => {
    const out = () => { setUser(null); };
    window.addEventListener('jwdash:logout', out);
    if (getToken()) {
      api.get('/auth/me').then(setUser).catch(() => setToken(null)).finally(() => setBooting(false));
    }
    return () => window.removeEventListener('jwdash:logout', out);
  }, []);

  useEffect(() => { if (user) loadTree().catch(() => {}); }, [user, loadTree]);

  // Flat index of the tree
  const nodes = useMemo(() => {
    const map = new Map();
    const walk = (n, parent) => { map.set(n.id, { ...n, parent }); n.children.forEach((c) => walk(c, n)); };
    tree.forEach((r) => walk(r, null));
    return map;
  }, [tree]);

  // Default node = root of the user's visible tree
  const nodeId = view.nodeId && nodes.has(view.nodeId) ? view.nodeId : tree[0]?.id || null;

  const login = async (email, password) => {
    const r = await api.post('/auth/login', { email, password });
    setToken(r.token);
    setUser(r.user);
    return r.user;
  };
  const logout = () => { setToken(null); setUser(null); setTree([]); };
  const refreshMe = async () => setUser(await api.get('/auth/me'));

  const value = {
    user, booting, login, logout, refreshMe, tree, nodes, loadTree, notify,
    view: { ...view, nodeId }, setView,
    isAdmin: user?.role === 'admin',
    canEnter: (companyId) => {
      if (!user) return false;
      if (user.role === 'admin') return true;
      if (user.role !== 'company' && user.role !== 'cluster') return false;
      for (let n = nodes.get(companyId); n; n = n.parent) if (n.id === user.node_id) return true;
      return false;
    },
  };

  return (
    <AppCtx.Provider value={value}>
      {children}
      {toast && <div key={toast.id} className={`toast ${toast.kind === 'err' ? 'err' : ''}`}>{toast.msg}</div>}
    </AppCtx.Provider>
  );
}
