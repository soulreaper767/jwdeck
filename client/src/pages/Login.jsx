import { useEffect, useState } from 'react';
import { useApp } from '../store.jsx';
import { api } from '../lib/api.js';

export default function Login() {
  const { login } = useApp();
  const [sync, setSync] = useState(null);
  const [hub, setHub] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.get('/sync/status').then(setSync).catch(() => setSync({ mode: 'hub' })); }, []);

  const connecting = sync?.mode === 'node' && !sync.connected;

  const go = async (e) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      if (connecting) {
        await api.post('/sync/connect', { hub, email, password });
        setSync(await api.get('/sync/status'));
      }
      await login(email, password);
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };

  if (!sync) return null;
  return (
    <form className="login" onSubmit={go}>
      <h1><b>JW</b> Dash</h1>
      {err && <div className="note err">{err}</div>}
      {connecting && <label className="f">Server address<input value={hub} onChange={(e) => setHub(e.target.value)} placeholder="https://jwdash.example.com" autoFocus /></label>}
      <label className="f">Email<input value={email} onChange={(e) => setEmail(e.target.value)} autoFocus={!connecting} autoComplete="username" /></label>
      <label className="f">Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></label>
      <button className="dark" disabled={busy}>{busy ? 'Please wait…' : connecting ? 'Connect & sign in' : 'Sign in'}</button>
      {sync.mode === 'node' && sync.connected && <div className="small mute">{sync.online ? 'Connected to' : 'Offline · server'} {sync.hub}</div>}
    </form>
  );
}
