import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useApp } from '../store.jsx';
import { api } from '../lib/api.js';
import { parseNum, plainNum, fv } from '../lib/format.js';
import { WeekSelect, Modal } from '../ui.jsx';

function NodeForm({ init, onClose, onSaved }) {
  const { notify, nodes } = useApp();
  const [f, setF] = useState({ ...init });
  const save = async () => {
    try {
      const body = { name: f.name, code: f.code, parent_id: f.parent_id, type: f.type, currency: 'PKR', sort: f.sort || 0, active: f.active ?? 1 };
      const r = f.id ? await api.put(`/nodes/${f.id}`, body) : await api.post('/nodes', body);
      onSaved(r);
    } catch (e) { notify(e.message, 'err'); }
  };
  return (
    <Modal title={f.id ? f.name : `New ${f.type}`} onClose={onClose}>
      <label className="f">Name<input value={f.name || ''} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></label>
      <label className="f">Code<input value={f.code || ''} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} /></label>
      {f.type !== 'group' && (
        <label className="f">Under
          <select value={f.parent_id || ''} onChange={(e) => setF({ ...f, parent_id: Number(e.target.value) })}>
            {[...nodes.values()].filter((n) => n.type !== 'company' && n.id !== f.id).map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
          </select>
        </label>
      )}
      {f.id && <label className="c"><input type="checkbox" checked={!!f.active} onChange={(e) => setF({ ...f, active: e.target.checked ? 1 : 0 })} />Active</label>}
      <div className="row"><span className="sp" /><button onClick={onClose}>Cancel</button><button className="dark" onClick={save}>Save</button></div>
    </Modal>
  );
}

function CompanySetup({ cid }) {
  const { notify } = useApp();
  const [d, setD] = useState(null);
  const [week, setWeek] = useState('');
  const [cash, setCash] = useState('');
  const [skus, setSkus] = useState([]);
  const load = () => api.get(`/companies/${cid}/setup`).then((r) => {
    setD(r);
    setWeek(r.setup?.start_week || r.suggested_start);
    setCash(plainNum(r.setup?.opening_cash));
    setSkus(r.skus.map((s) => ({ ...s })));
  });
  useEffect(() => { load(); }, [cid]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return null;

  const saveOpening = async () => {
    try { await api.put(`/companies/${cid}/setup`, { start_week: week, opening_cash: parseNum(cash) }); notify('Saved'); load(); } catch (e) { notify(e.message, 'err'); }
  };
  const saveSkus = async () => {
    try { await api.put(`/companies/${cid}/skus`, { skus }); notify('Saved'); load(); } catch (e) { notify(e.message, 'err'); }
  };
  const up = (i, p) => setSkus(skus.map((s, j) => (j === i ? { ...s, ...p } : s)));

  return (
    <>
      <h3 style={{ margin: '20px 0 8px' }}>Opening position</h3>
      {d.setup && !d.can_edit_opening ? (
        <div>{fv(d.setup.opening_cash, 'amount', '1')} PKR · from {d.setup.start_week}</div>
      ) : (
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <label className="f">First reporting week<WeekSelect value={week} onChange={setWeek} /></label>
          <label className="f">Cash & bank at start (PKR)<input className="n" value={cash} style={{ width: 180 }} onChange={(e) => setCash(e.target.value)} onBlur={() => setCash(plainNum(parseNum(cash)))} /></label>
          <button className="dark" onClick={saveOpening}>Save</button>
        </div>
      )}

      <h3 style={{ margin: '24px 0 8px' }}>SKUs / items</h3>
      <table className="r" style={{ maxWidth: 620 }}>
        <thead><tr><th className="l">Name</th><th className="l">Unit</th><th className="l">Active</th><th /></tr></thead>
        <tbody>
          {skus.map((s, i) => (
            <tr key={s.id || `n${i}`}>
              <td className="l"><input value={s.name} disabled={!d.can_edit_skus} onChange={(e) => up(i, { name: e.target.value })} style={{ width: '100%' }} /></td>
              <td className="l"><input value={s.unit} disabled={!d.can_edit_skus} onChange={(e) => up(i, { unit: e.target.value })} style={{ width: 90 }} list="units" /></td>
              <td className="l"><input type="checkbox" disabled={!d.can_edit_skus} checked={!!s.active} onChange={(e) => up(i, { active: e.target.checked ? 1 : 0 })} /></td>
              <td className="n">{d.can_edit_skus && !s.used && <button className="link" onClick={() => setSkus(skus.filter((_, j) => j !== i))}>remove</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <datalist id="units">{['litres', 'kg', 'tons', 'packs', 'cartons', 'pcs', 'head', 'units'].map((u) => <option key={u} value={u} />)}</datalist>
      {d.can_edit_skus && (
        <div className="row" style={{ marginTop: 8 }}>
          <button onClick={() => setSkus([...skus, { name: '', unit: 'units', active: 1 }])}>Add</button>
          <button className="dark" onClick={saveSkus}>Save SKUs</button>
        </div>
      )}
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
      <div className="bar"><h2>Companies</h2></div>
      <div className="row" style={{ alignItems: 'flex-start', gap: 40 }}>
        <div style={{ minWidth: 280 }}>
          {[...nodes.values()].map((n) => (
            <div key={n.id} onClick={() => setSel(n.id)}
              style={{ padding: '5px 8px', paddingLeft: 8 + n.depth * 18, cursor: 'pointer', background: node?.id === n.id ? 'var(--hi)' : undefined, opacity: n.active ? 1 : 0.5,
                fontFamily: n.type !== 'company' ? 'Georgia, serif' : undefined, fontSize: n.type === 'group' ? 15 : 13, borderBottom: '1px solid var(--rule-2)' }}>
              {n.name}
            </div>
          ))}
        </div>
        {node && (
          <div style={{ flex: 1, minWidth: 320 }}>
            <div className="title">
              <h1>{node.name}</h1><span className="meta">{node.type} · {node.code}{node.active ? '' : ' · inactive'}</span>
              <span className="sp" />
              {isAdmin && <button onClick={() => setForm({ ...node })}>Edit</button>}
              {isAdmin && node.type !== 'company' && <>
                <button onClick={() => setForm({ type: 'cluster', parent_id: node.id })}>Add cluster</button>
                <button onClick={() => setForm({ type: 'company', parent_id: node.id })}>Add company</button>
              </>}
              {isAdmin && !node.children.length && node.type !== 'group' && (
                <button onClick={async () => { if (!window.confirm(`Delete ${node.name}?`)) return; try { await api.del(`/nodes/${node.id}`); setSel(null); loadTree(); } catch (e) { notify(e.message, 'err'); } }}>Delete</button>
              )}
            </div>
            {node.type === 'company' ? (
              <>
                <div className="row small"><Link to={`/enter/${node.id}`}>Enter figures</Link><Link to="/budgets">Budgets</Link></div>
                <CompanySetup cid={node.id} />
              </>
            ) : (
              <table className="r" style={{ maxWidth: 520, marginTop: 10 }}>
                <tbody>{node.children.map((c) => <tr key={c.id} className="click" onClick={() => setSel(c.id)}><td className="l">{c.name}</td><td className="l mute">{c.type}</td></tr>)}</tbody>
              </table>
            )}
          </div>
        )}
      </div>
      {form && <NodeForm init={form} onClose={() => setForm(null)} onSaved={async (r) => { setForm(null); await loadTree(); setSel(r.id); }} />}
    </>
  );
}
