import { useState } from 'react';
import { useApp } from '../store.jsx';

export default function Login() {
  const { login } = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const go = async (e) => {
    e.preventDefault();
    setErr('');
    try { await login(email, password); } catch (x) { setErr(x.message); }
  };
  return (
    <form className="login" onSubmit={go}>
      <h1><b>JW</b> Dash</h1>
      {err && <div className="note err">{err}</div>}
      <label className="f">Email<input value={email} onChange={(e) => setEmail(e.target.value)} autoFocus autoComplete="username" /></label>
      <label className="f">Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></label>
      <button className="dark">Sign in</button>
    </form>
  );
}
