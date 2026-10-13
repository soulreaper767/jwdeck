import { useState } from 'react';
import { useApp } from '../store.jsx';

export default function Login() {
  const { login } = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try { await login(email, password); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };

  return (
    <div className="login-wrap">
      <form className="login stack" onSubmit={submit}>
        <div className="brand">
          <div className="logo">JW</div>
          <div><b>JW Dash</b><span>Group financial reporting</span></div>
        </div>
        {err && <div className="alert err">{err}</div>}
        <label className="field">Email<input value={email} onChange={(e) => setEmail(e.target.value)} autoFocus autoComplete="username" /></label>
        <label className="field">Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></label>
        <button className="primary" disabled={busy} style={{ justifyContent: 'center', padding: 10 }}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>
  );
}
