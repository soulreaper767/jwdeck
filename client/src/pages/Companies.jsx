import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useApp } from '../store.jsx';
import { api } from '../lib/api.js';
import { parseNum, plainNum, fv } from '../lib/format.js';
import { WeekSelect, Modal, Logo } from '../ui.jsx';

const TYPES = ['Holding / group', 'Business cluster', 'Private limited company', 'Public limited (listed)', 'Public limited (unlisted)',
  'Partnership', 'Sole proprietorship', 'Joint venture', 'Branch / division', 'Foreign entity', 'Other'];
const FIELDS = [
  ['short_name', 'Short name'], ['legal_name', 'Legal name'], ['entity_type', 'Entity type', 'type'], ['business_nature', 'Nature of business'],
  ['start_date', 'Date of start / incorporation', 'date'], ['employees', 'Employees'], ['registration_no', 'Registration no.'], ['ntn', 'NTN'],
  ['strn', 'STRN'], ['head_name', 'Head (name)'], ['head_title', 'Head (title)'], ['finance_contact', 'Finance contact'],
  ['email', 'Email'], ['phone', 'Phone'], ['website', 'Website'], ['city', 'City'], ['country', 'Country'], ['address', 'Address', 'wide'],
  ['description', 'Description', 'text'],
];

// shrink an uploaded logo to ≤256px PNG data URL
function readLogo(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const r = new FileReader();
    r.onload = () => { img.src = r.result; };
    r.onerror = reject;
    img.onload = () => {
      const k = Math.min(1, 256 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k);
      c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/png'));
    };
    r.readAsDataURL(file);
  });
}

function NodeForm({ init, onClose, onSaved }) {
  const { notify, nodes } = useApp();
  const [f, setF] = useState({ active: 1, ...init, meta: { ...(init.meta || {}) } });
  const m = (k, v) => setF((x) => ({ ...x, meta: { ...x.meta, [k]: v } }));
  const save = async () => {
    try {
      const body = { name: f.name, code: f.code, parent_id: f.parent_id, type: f.type, currency: 'PKR', sort: f.sort || 0, active: f.active, meta: f.meta };
      onSaved(f.id ? await api.put(`/nodes/${f.id}`, body) : await api.post('/nodes', body));
    } catch (e) { notify(e.message, 'err'); }
  };
  return (
    <Modal title={f.id ? f.name : `New ${f.type}`} onClose={onClose} wide>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <Logo node={{ name: f.name, logo: f.meta.logo }} size="lg" />
        <label className="f">Logo<input type="file" accept="image/*" onChange={async (e) => e.target.files[0] && m('logo', await readLogo(e.target.files[0]))} /></label>
        {f.meta.logo && <button className="link" onClick={() => m('logo', '')}>remove</button>}
      </div>
      <div className="form2">
        <label className="f">Name<input value={f.name || ''} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></label>
        <label className="f">Code<input value={f.code || ''} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} /></label>
        {f.type !== 'group' && (
          <label className="f">Reports into
            <select value={f.parent_id || ''} onChange={(e) => setF({ ...f, parent_id: Number(e.target.value) })}>
              {[...nodes.values()].filter((n) => n.type !== 'company' && n.id !== f.id).map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
            </select>
          </label>
        )}
        {FIELDS.map(([k, label, kind]) => (
          <label key={k} className="f" style={kind === 'text' || kind === 'wide' ? { gridColumn: '1 / -1' } : undefined}>{label}
            {kind === 'type' ? (
              <select value={f.meta[k] || ''} onChange={(e) => m(k, e.target.value)}><option value="" />{TYPES.map((t) => <option key={t}>{t}</option>)}</select>
            ) : kind === 'text' ? <textarea rows={3} value={f.meta[k] || ''} onChange={(e) => m(k, e.target.value)} />
              : <input type={kind === 'date' ? 'date' : 'text'} value={f.meta[k] || ''} onChange={(e) => m(k, e.target.value)} />}
          </label>
        ))}
      </div>
      {f.id && <label className="c"><input type="checkbox" checked={!!f.active} onChange={(e) => setF({ ...f, active: e.target.checked ? 1 : 0 })} />Active</label>}
      <div className="row"><span className="sp" /><button onClick={onClose}>Cancel</button><button className="dark" onClick={save}>Save</button></div>
    </Modal>
  );
}

function Profile({ node }) {
  const meta = node.meta || {};
  const shown = FIELDS.filter(([k]) => meta[k]);
  if (!shown.length) return <div className="mute small">No profile details yet.</div>;
  return (
    <table className="r" style={{ maxWidth: 760 }}>
      <tbody>{shown.map(([k, label]) => <tr key={k}><td className="l mute" style={{ width: 220 }}>{label}</td><td className="l" style={{ whiteSpace: 'pre-wrap' }}>{meta[k]}</td></tr>)}</tbody>
    </table>
  );
}

function CompanySetup({ cid }) {
  const { notify } = useApp();
  const [d, setD] = useState(null);
  const [week, setWeek] = useState('');
  const [cash, setCash] = useState('');
  const [skus, setSkus] = useState([]);
  const load = () => api.get(`/companies/${cid}/setup`).then((r) => { setD(r); setWeek(r.setup?.start_week || r.suggested_start); setCash(plainNum(r.setup?.opening_cash)); setSkus(r.skus.map((s) => ({ ...s }))); });
  useEffect(() => { load(); }, [cid]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return null;
  const saveOpening = async () => { try { await api.put(`/companies/${cid}/setup`, { start_week: week, opening_cash: parseNum(cash) }); notify('Saved'); load(); } catch (e) { notify(e.message, 'err'); } };
  const saveSkus = async () => { try { await api.put(`/companies/${cid}/skus`, { skus }); notify('Saved'); load(); } catch (e) { notify(e.message, 'err'); } };
  const up = (i, p) => setSkus(skus.map((s, j) => (j === i ? { ...s, ...p } : s)));
  return (
    <>
      <h2 className="part">Opening position</h2>
      {d.setup && !d.can_edit_opening ? <div>{fv(d.setup.opening_cash, 'amount', '1')} PKR · from {d.setup.start_week}</div> : (
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <label className="f">First reporting week<WeekSelect value={week} onChange={setWeek} /></label>
          <label className="f">Cash & bank at start (PKR)<input className="n" value={cash} style={{ width: 180 }} onChange={(e) => setCash(e.target.value)} onBlur={() => setCash(plainNum(parseNum(cash)))} /></label>
          <button className="dark" onClick={saveOpening}>Save</button>
        </div>
      )}
      <h2 className="part">SKUs / items</h2>
      <div className="wrap"><table className="r" style={{ maxWidth: 640 }}>
        <thead><tr><th className="l">Name</th><th className="l">Unit</th><th className="l">Active</th><th /></tr></thead>
        <tbody>{skus.map((s, i) => (
          <tr key={s.id || `n${i}`}>
            <td className="l"><input value={s.name} disabled={!d.can_edit_skus} onChange={(e) => up(i, { name: e.target.value })} style={{ width: '100%' }} /></td>
            <td className="l"><input value={s.unit} disabled={!d.can_edit_skus} onChange={(e) => up(i, { unit: e.target.value })} style={{ width: 100 }} list="units" /></td>
            <td className="l"><input type="checkbox" disabled={!d.can_edit_skus} checked={!!s.active} onChange={(e) => up(i, { active: e.target.checked ? 1 : 0 })} /></td>
            <td className="n">{d.can_edit_skus && !s.used && <button className="link" onClick={() => setSkus(skus.filter((_, j) => j !== i))}>remove</button>}</td>
          </tr>
        ))}</tbody>
      </table></div>
      <datalist id="units">{['litres', 'kg', 'tons', 'packs', 'cartons', 'pcs', 'head', 'units'].map((u) => <option key={u} value={u} />)}</datalist>
      {d.can_edit_skus && <div className="row" style={{ marginTop: 8 }}><button onClick={() => setSkus([...skus, { name: '', unit: 'units', active: 1 }])}>Add</button><button className="dark" onClick={saveSkus}>Save SKUs</button></div>}
    </>
  );
}

export default function Companies() {
  const { nodes, tree, loadTree, isAdmin, notify } = useApp();
  const [sp] = useSearchParams();
  const [sel, setSel] = useState(Number(sp.get('c')) || null);
  const [form, setForm] = useState(null);
  const node = nodes.get(sel || tree[0]?.id);

  return (
    <>
      <div className="bar">
        <select value={node?.id || ''} onChange={(e) => setSel(Number(e.target.value))}>
          {[...nodes.values()].map((n) => <option key={n.id} value={n.id}>{'    '.repeat(n.depth)}{n.name}</option>)}
        </select>
      </div>
      {node && (
        <>
          <div className="title">
            <Logo node={node} size="lg" />
            <div>
              <h1>{node.name}</h1>
              <div className="meta">{node.meta?.entity_type || node.type}{node.meta?.business_nature ? ` · ${node.meta.business_nature}` : ''}{node.active ? '' : ' · inactive'}</div>
            </div>
            <span className="sp" />
            {isAdmin && <button onClick={() => setForm({ ...node })}>Edit profile</button>}
            {isAdmin && node.type !== 'company' && <>
              <button onClick={() => setForm({ type: 'cluster', parent_id: node.id })}>Add cluster</button>
              <button onClick={() => setForm({ type: 'company', parent_id: node.id })}>Add company</button>
            </>}
            {isAdmin && !node.children.length && node.type !== 'group' && (
              <button onClick={async () => { if (!window.confirm(`Delete ${node.name}?`)) return; try { await api.del(`/nodes/${node.id}`); setSel(null); loadTree(); } catch (e) { notify(e.message, 'err'); } }}>Delete</button>
            )}
          </div>
          {node.meta?.description && <p style={{ maxWidth: 800 }}>{node.meta.description}</p>}
          <h2 className="part">Profile</h2>
          <Profile node={node} />
          {node.children.length > 0 && (
            <>
              <h2 className="part">{node.type === 'group' ? 'Clusters' : 'Companies'}</h2>
              <div className="wrap"><table className="r" style={{ maxWidth: 760 }}>
                <tbody>{node.children.map((c) => (
                  <tr key={c.id} className="click" onClick={() => setSel(c.id)}>
                    <td className="l" style={{ width: 40 }}><Logo node={c} size="sm" /></td>
                    <td className="l">{c.name}</td><td className="l mute">{c.meta?.business_nature || c.type}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            </>
          )}
          {node.type === 'company' && (
            <>
              <div className="row small" style={{ marginTop: 10 }}><Link to={`/enter/${node.id}`}>Weekly entry</Link><Link to={`/close/${node.id}`}>Month close</Link><Link to="/budgets">Budgets</Link></div>
              <CompanySetup cid={node.id} />
            </>
          )}
        </>
      )}
      {form && <NodeForm init={form} onClose={() => setForm(null)} onSaved={async (r) => { setForm(null); await loadTree(); setSel(r.id); }} />}
    </>
  );
}
