import { useEffect, useState } from 'react';
import { useApp } from '../store.jsx';
import { api } from '../lib/api.js';
import { Modal, Loading } from '../ui.jsx';

const NEEDS = { company_dpo: 'company', company_reviewer: 'company', cluster_reviewer: 'cluster', executive: 'any', group_reviewer: 'any' };

function Form({ init, roles, onClose, onSaved }) {
  const { notify, nodes } = useApp();
  const [f, setF] = useState({ role: 'company_dpo', active: 1, ...init, scopes: (init.scopes || []).map((s) => s.id), password: '' });
  const kind = NEEDS[f.role];
  const options = [...nodes.values()].filter((n) => (kind === 'any' ? true : n.type === kind));
  const toggle = (id) => setF({ ...f, scopes: f.scopes.includes(id) ? f.scopes.filter((x) => x !== id) : [...f.scopes, id] });
  const save = async () => {
    try { if (f.id) await api.put(`/users/${f.id}`, f); else await api.post('/users', f); onSaved(); } catch (e) { notify(e.message, 'err'); }
  };
  return (
    <Modal title={f.id ? f.name : 'New user'} onClose={onClose}>
      <div className="form2">
        <label className="f">Name<input value={f.name || ''} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></label>
        <label className="f">Title<input value={f.title || ''} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
        <label className="f">Email<input value={f.email || ''} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
        <label className="f">Role<select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value, scopes: [] })}>{Object.entries(roles).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      </div>
      {kind && (
        <div>
          <div className="small mute" style={{ marginBottom: 4 }}>{kind === 'any' ? 'Scope (none = whole group)' : kind === 'cluster' ? 'Clusters' : 'Company'}</div>
          {options.map((n) => (
            <label key={n.id} className="c" style={{ display: 'flex', paddingLeft: kind === 'any' ? n.depth * 16 : 0 }}>
              <input type={kind === 'company' ? 'radio' : 'checkbox'} checked={f.scopes.includes(n.id)}
                onChange={() => (kind === 'company' ? setF({ ...f, scopes: [n.id] }) : toggle(n.id))} />{n.name}
            </label>
          ))}
        </div>
      )}
      <label className="f">{f.id ? 'New password' : 'Password'}<input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" /></label>
      {f.id && <label className="c"><input type="checkbox" checked={!!f.active} onChange={(e) => setF({ ...f, active: e.target.checked ? 1 : 0 })} />Active</label>}
      <div className="row"><span className="sp" /><button onClick={onClose}>Cancel</button><button className="dark" onClick={save}>Save</button></div>
    </Modal>
  );
}

export default function Users() {
  const [d, setD] = useState(null);
  const [form, setForm] = useState(null);
  const load = () => api.get('/users').then(setD);
  useEffect(() => { load(); }, []);
  return (
    <>
      <div className="bar"><h2>Users</h2><span className="sp" /><button className="dark" onClick={() => setForm({})}>Add user</button></div>
      {!d ? <Loading /> : (
        <div className="wrap">
          <table className="r">
            <thead><tr><th className="l">Name</th><th className="l">Email</th><th className="l">Role</th><th className="l">Scope</th><th className="l" /></tr></thead>
            <tbody>{d.users.map((u) => (
              <tr key={u.id} className="click" onClick={() => setForm(u)}>
                <td className="l">{u.name}<div className="small mute">{u.title}</div></td><td className="l">{u.email}</td><td className="l">{d.roles[u.role]}</td>
                <td className="l">{u.scopes.length ? u.scopes.map((s) => s.name).join(', ') : 'Whole group'}</td><td className="l mute">{u.active ? '' : 'disabled'}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {form && d && <Form init={form} roles={d.roles} onClose={() => setForm(null)} onSaved={() => { setForm(null); load(); }} />}
    </>
  );
}
