import { useEffect, useState } from 'react';
import { useApp } from '../store.jsx';
import { api } from '../lib/api.js';
import { Modal, Spinner } from '../components/ui.jsx';
import { NodePicker } from '../components/ViewBar.jsx';

const ROLES = {
  admin: 'Admin: Group Finance. Full setup rights, can reopen filings.',
  executive: 'Executive: views everything under their scope (whole group if no scope).',
  cluster: 'Cluster head: views and files for companies in their cluster.',
  company: 'Company user: files and views their own company.',
};

function UserForm({ initial, onClose, onSaved }) {
  const { notify } = useApp();
  const [f, setF] = useState({ role: 'company', active: 1, ...initial, password: '' });
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    try {
      if (f.id) await api.put(`/users/${f.id}`, f); else await api.post('/users', f);
      notify('User saved');
      onSaved();
    } catch (e) { notify(e.message, 'err'); }
  };
  const needsScope = f.role === 'cluster' || f.role === 'company';
  return (
    <Modal title={f.id ? 'Edit user' : 'New user'} onClose={onClose}
      footer={<><button onClick={onClose}>Cancel</button><button className="primary" onClick={save}>Save</button></>}>
      <div className="form2">
        <label className="field">Name<input value={f.name || ''} onChange={(e) => set('name', e.target.value)} autoFocus /></label>
        <label className="field">Email<input value={f.email || ''} onChange={(e) => set('email', e.target.value)} /></label>
      </div>
      <label className="field">Role<select value={f.role} onChange={(e) => set('role', e.target.value)}>
        {Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      {f.role !== 'admin' && (
        <label className="field">{needsScope ? 'Belongs to' : 'Limit view to (optional)'}
          <div className="row">
            <NodePicker value={f.node_id} onChange={(id) => set('node_id', id)} placeholder={needsScope ? 'Pick…' : 'Whole group'}
              filter={(n, picking) => (picking && f.role === 'company' ? n.type === 'company' : true)} />
            {!needsScope && f.node_id && <button className="ghost sm" onClick={() => set('node_id', null)}>Clear</button>}
          </div>
        </label>
      )}
      <label className="field">{f.id ? 'Reset password (leave blank to keep)' : 'Password'}
        <input type="password" value={f.password} onChange={(e) => set('password', e.target.value)} autoComplete="new-password" /></label>
      {f.id && <label className="check"><input type="checkbox" checked={!!f.active} onChange={(e) => set('active', e.target.checked ? 1 : 0)} />Active</label>}
    </Modal>
  );
}

export default function Users() {
  const [users, setUsers] = useState(null);
  const [form, setForm] = useState(null);
  const load = () => api.get('/users').then(setUsers);
  useEffect(() => { load(); }, []);
  return (
    <>
      <div className="topbar"><h2>Users & access</h2><div className="spacer" /><button className="primary" onClick={() => setForm({})}>+ New user</button></div>
      <div className="content">
        {!users ? <Spinner /> : (
          <div className="card"><div className="card-b flush">
            <table className="t">
              <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Scope</th><th>Status</th></tr></thead>
              <tbody>{users.map((u) => (
                <tr key={u.id} className="click" onClick={() => setForm(u)}>
                  <td><b>{u.name}</b></td><td>{u.email}</td><td style={{ textTransform: 'capitalize' }}>{u.role}</td>
                  <td>{u.node_name || <span className="muted">Whole group</span>}</td>
                  <td>{u.active ? <span className="badge filed">Active</span> : <span className="badge">Disabled</span>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div></div>
        )}
      </div>
      {form && <UserForm initial={form} onClose={() => setForm(null)} onSaved={() => { setForm(null); load(); }} />}
    </>
  );
}
