import { useEffect, useState } from 'react';
import { useApp } from '../store.jsx';
import { api } from '../lib/api.js';
import { Modal, NodeSelect, Loading } from '../ui.jsx';

const ROLES = { admin: 'Group finance (admin)', executive: 'Executive', cluster: 'Cluster', company: 'Company' };

function Form({ init, onClose, onSaved }) {
  const { notify } = useApp();
  const [f, setF] = useState({ role: 'company', active: 1, ...init, password: '' });
  const save = async () => {
    try { if (f.id) await api.put(`/users/${f.id}`, f); else await api.post('/users', f); onSaved(); } catch (e) { notify(e.message, 'err'); }
  };
  return (
    <Modal title={f.id ? f.name : 'New user'} onClose={onClose}>
      <label className="f">Name<input value={f.name || ''} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></label>
      <label className="f">Email<input value={f.email || ''} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
      <label className="f">Role<select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>{Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      {f.role !== 'admin' && <label className="f">Scope<NodeSelect value={f.node_id} allowEmpty={f.role === 'executive' ? 'Whole group' : '—'} companiesOnly={f.role === 'company'} onChange={(id) => setF({ ...f, node_id: id })} /></label>}
      <label className="f">{f.id ? 'New password' : 'Password'}<input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" /></label>
      {f.id && <label className="c"><input type="checkbox" checked={!!f.active} onChange={(e) => setF({ ...f, active: e.target.checked ? 1 : 0 })} />Active</label>}
      <div className="row"><span className="sp" /><button onClick={onClose}>Cancel</button><button className="dark" onClick={save}>Save</button></div>
    </Modal>
  );
}

export default function Users() {
  const [rows, setRows] = useState(null);
  const [form, setForm] = useState(null);
  const load = () => api.get('/users').then(setRows);
  useEffect(() => { load(); }, []);
  return (
    <>
      <div className="bar"><h2>Users</h2><span className="sp" /><button className="dark" onClick={() => setForm({})}>Add user</button></div>
      {!rows ? <Loading /> : (
        <table className="r" style={{ maxWidth: 900 }}>
          <thead><tr><th className="l">Name</th><th className="l">Email</th><th className="l">Role</th><th className="l">Scope</th><th className="l" /></tr></thead>
          <tbody>{rows.map((u) => (
            <tr key={u.id} className="click" onClick={() => setForm(u)}>
              <td className="l">{u.name}</td><td className="l">{u.email}</td><td className="l">{ROLES[u.role]}</td>
              <td className="l">{u.node_name || 'Whole group'}</td><td className="l mute">{u.active ? '' : 'disabled'}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {form && <Form init={form} onClose={() => setForm(null)} onSaved={() => { setForm(null); load(); }} />}
    </>
  );
}
