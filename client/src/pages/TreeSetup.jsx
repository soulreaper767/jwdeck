import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../store.jsx';
import { api } from '../lib/api.js';
import { TreeView, Modal, Confirm } from '../components/ui.jsx';

const TYPE_NAME = { group: 'Group', cluster: 'Cluster', company: 'Company' };

function NodeForm({ initial, parent, onClose, onSaved }) {
  const { notify, nodes } = useApp();
  const editing = !!initial.id;
  const [f, setF] = useState({ currency: parent?.currency || 'PKR', sort: 0, ...initial, meta: initial.meta || {} });
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const setMeta = (k, v) => setF((x) => ({ ...x, meta: { ...x.meta, [k]: v } }));
  const parents = [...nodes.values()].filter((n) => n.type !== 'company' && n.id !== f.id);

  const save = async () => {
    try {
      const body = { ...f, children: undefined, parent: undefined };
      const r = editing ? await api.put(`/nodes/${f.id}`, body) : await api.post('/nodes', body);
      notify(`${TYPE_NAME[f.type]} saved`);
      onSaved(r);
    } catch (e) { notify(e.message, 'err'); }
  };

  return (
    <Modal title={`${editing ? 'Edit' : 'New'} ${TYPE_NAME[f.type].toLowerCase()}`} onClose={onClose}
      footer={<><button onClick={onClose}>Cancel</button><button className="primary" onClick={save}>Save</button></>}>
      <div className="form2">
        <label className="field">Name<input value={f.name || ''} onChange={(e) => set('name', e.target.value)} autoFocus /></label>
        <label className="field">Short code<input value={f.code || ''} onChange={(e) => set('code', e.target.value.toUpperCase())} placeholder="e.g. JW-SPN" /></label>
        {f.type !== 'group' && (
          <label className="field">Reports into
            <select value={f.parent_id || ''} onChange={(e) => set('parent_id', Number(e.target.value))}>
              {parents.map((p) => <option key={p.id} value={p.id}>{p.parent ? '— ' : ''}{p.name} ({TYPE_NAME[p.type]})</option>)}
            </select>
          </label>
        )}
        <label className="field">{f.type === 'company' ? 'Reporting currency' : 'Currency'}
          <input value={f.currency || ''} maxLength={3} onChange={(e) => set('currency', e.target.value.toUpperCase())} />
        </label>
        <label className="field">Display order<input type="number" value={f.sort} onChange={(e) => set('sort', e.target.value)} /></label>
        {f.type === 'company' && <>
          <label className="field">Legal name / registration<input value={f.meta.legal || ''} onChange={(e) => setMeta('legal', e.target.value)} /></label>
          <label className="field">Finance contact<input value={f.meta.contact || ''} onChange={(e) => setMeta('contact', e.target.value)} /></label>
          <label className="field">Industry / business line<input value={f.meta.industry || ''} onChange={(e) => setMeta('industry', e.target.value)} /></label>
        </>}
      </div>
      {editing && <label className="check"><input type="checkbox" checked={!!f.active} onChange={(e) => set('active', e.target.checked ? 1 : 0)} />Active (inactive units stop reporting and are left out of consolidation)</label>}
    </Modal>
  );
}

export default function TreeSetup() {
  const { tree, nodes, loadTree, notify } = useApp();
  const [sel, setSel] = useState(null);
  const [form, setForm] = useState(null);
  const [del, setDel] = useState(null);
  const [counts, setCounts] = useState({});

  useEffect(() => {
    api.get('/mapping?frequency=monthly').then((m) => setCounts(m.line_counts)).catch(() => {});
  }, [tree]);

  const node = sel ? nodes.get(sel) : null;
  const companiesBelow = (n) => (n.type === 'company' ? 1 : n.children.reduce((a, c) => a + companiesBelow(c), 0));

  return (
    <>
      <div className="topbar"><h2>Company tree</h2><div className="spacer" />
        {tree.length === 0 && <button className="primary" onClick={() => setForm({ initial: { type: 'group' } })}>+ Create group</button>}
      </div>
      <div className="content">
        <div className="grid" style={{ gridTemplateColumns: 'minmax(320px, 1fr) minmax(0, 1.2fr)', alignItems: 'start' }}>
          <div className="card">
            <div className="card-h"><h3>Structure</h3><span className="muted small">Group → clusters (can nest) → companies</span></div>
            <div className="card-b">
              <TreeView roots={tree} selected={sel} onSelect={(n) => setSel(n.id)} defaultOpen={4}
                render={(n) => (n.type === 'company'
                  ? <span className="faint small">{n.currency}{counts[n.id] ? '' : ' · no format'}</span>
                  : <span className="faint small">{companiesBelow(n)} co.</span>)} />
            </div>
          </div>
          {node ? (
            <div className="card">
              <div className="card-h">
                <span className={`ico ${node.type}`} style={{ width: 24, height: 24, borderRadius: 6, display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700 }}>{node.type === 'company' ? 'Co' : node.type[0].toUpperCase()}</span>
                <div><h2>{node.name}</h2><div className="muted small">{TYPE_NAME[node.type]} · {node.code} · {node.currency}{node.active ? '' : ' · inactive'}</div></div>
                <div className="spacer" />
                <button onClick={() => setForm({ initial: node })}>Edit</button>
                <button className="danger" onClick={() => setDel(node)}>Delete</button>
              </div>
              <div className="card-b stack">
                {node.type !== 'company' && (
                  <div className="row">
                    <button className="primary" onClick={() => setForm({ initial: { type: 'cluster', parent_id: node.id }, parent: node })}>+ Add cluster</button>
                    <button className="primary" onClick={() => setForm({ initial: { type: 'company', parent_id: node.id }, parent: node })}>+ Add company</button>
                  </div>
                )}
                {node.type === 'company' && (
                  <div className="stack">
                    <div className="small muted">{node.meta?.legal && <>Legal: {node.meta.legal} · </>}{node.meta?.industry && <>Industry: {node.meta.industry} · </>}{node.meta?.contact && <>Contact: {node.meta.contact}</>}</div>
                    <div className="row wrap">
                      <Link to={`/setup/formats/${node.id}/monthly`}><button>Monthly format ({counts[node.id] || 0} lines)</button></Link>
                      <Link to={`/setup/formats/${node.id}/weekly`}><button>Weekly format</button></Link>
                      <Link to={`/company/${node.id}`}><button>View reports</button></Link>
                      <Link to={`/entry/${node.id}/monthly`}><button>Enter figures</button></Link>
                    </div>
                    {!counts[node.id] && <div className="alert warn">No monthly reporting format yet. Set one up so this company can file.</div>}
                  </div>
                )}
                {node.children.length > 0 && (
                  <table className="t">
                    <thead><tr><th>Directly under {node.name}</th><th>Type</th><th>Currency</th><th /></tr></thead>
                    <tbody>{node.children.map((c) => (
                      <tr key={c.id} className="click" onClick={() => setSel(c.id)}>
                        <td>{c.name} <span className="faint small">{c.code}</span></td><td>{TYPE_NAME[c.type]}</td><td>{c.currency}</td>
                        <td>{!c.active && <span className="badge">inactive</span>}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                )}
              </div>
            </div>
          ) : <div className="card"><div className="empty">Select a node to manage it, or add clusters and companies under the group.</div></div>}
        </div>
      </div>
      {form && <NodeForm initial={form.initial} parent={form.parent} onClose={() => setForm(null)}
        onSaved={async (r) => { setForm(null); await loadTree(); setSel(r.id); }} />}
      {del && <Confirm title={`Delete ${del.name}?`} danger confirmText="Delete" onClose={() => setDel(null)}
        message="Only empty units with no figures can be deleted. Units with history should be deactivated instead."
        onConfirm={async () => { try { await api.del(`/nodes/${del.id}`); notify('Deleted'); setSel(null); await loadTree(); } catch (e) { notify(e.message, 'err'); throw e; } }} />}
    </>
  );
}
