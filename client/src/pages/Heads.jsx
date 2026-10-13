import { useEffect, useState } from 'react';
import { useApp } from '../store.jsx';
import { api } from '../lib/api.js';
import { Modal, Confirm, Spinner } from '../components/ui.jsx';

const TYPES = {
  section: 'Section: groups heads for display, no total',
  input: 'Input: companies map their lines to this head',
  group: 'Group: total of the sub-heads under it',
  formula: 'Formula: calculated from other heads',
};
const STATEMENTS = { PL: 'Profit & loss', CF: 'Cash flow', BS: 'Position / balance', KPI: 'Operating KPI' };

function HeadForm({ initial, heads, onClose, onSaved }) {
  const { notify } = useApp();
  const [f, setF] = useState({ head_type: 'input', statement: 'PL', nature: 'flow', fmt: 'amount', higher_is_better: 1, frequency: 'both', is_kpi: 0, sort: 0, active: 1, ...initial });
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    try {
      const r = f.id ? await api.put(`/heads/${f.id}`, f) : await api.post('/heads', f);
      notify('Head saved');
      onSaved(r);
    } catch (e) { notify(e.message, 'err'); }
  };
  return (
    <Modal title={f.id ? `Edit head ${f.code}` : 'New group head'} onClose={onClose} wide
      footer={<><button onClick={onClose}>Cancel</button><button className="primary" onClick={save}>Save</button></>}>
      <div className="form2">
        <label className="field">Code (used in formulas)<input value={f.code || ''} onChange={(e) => set('code', e.target.value.toUpperCase())} autoFocus /></label>
        <label className="field">Name<input value={f.name || ''} onChange={(e) => set('name', e.target.value)} /></label>
        <label className="field">Type<select value={f.head_type} onChange={(e) => set('head_type', e.target.value)}>
          {Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="field">Sits under<select value={f.parent_id || ''} onChange={(e) => set('parent_id', e.target.value ? Number(e.target.value) : null)}>
          <option value="">(top level)</option>
          {heads.filter((h) => h.id !== f.id && h.head_type !== 'formula').map((h) => <option key={h.id} value={h.id}>{'— '.repeat(h.depth)}{h.name} ({h.code})</option>)}
        </select></label>
        {f.head_type === 'formula' && (
          <label className="field" style={{ gridColumn: '1 / -1' }}>Formula (head codes with + − × ÷ and brackets)
            <input value={f.formula || ''} onChange={(e) => set('formula', e.target.value.toUpperCase())} placeholder="e.g. GP / REV * 100" style={{ fontFamily: 'Consolas, monospace' }} />
          </label>
        )}
        <label className="field">Statement<select value={f.statement} onChange={(e) => set('statement', e.target.value)}>
          {Object.entries(STATEMENTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="field">How periods add up<select value={f.nature} onChange={(e) => set('nature', e.target.value)}>
          <option value="flow">Flow: sum across periods (sales, expenses)</option>
          <option value="balance">Balance: take the closing value (cash, debt)</option>
          <option value="average">Average across periods</option>
        </select></label>
        <label className="field">Display as<select value={f.fmt} onChange={(e) => set('fmt', e.target.value)}>
          <option value="amount">Amount (currency, FX-translated)</option><option value="number">Number (count, not translated)</option><option value="percent">Percent</option>
        </select></label>
        <label className="field">Reported in<select value={f.frequency} onChange={(e) => set('frequency', e.target.value)}>
          <option value="both">Weekly & monthly</option><option value="monthly">Monthly only</option><option value="weekly">Weekly only</option>
        </select></label>
        <label className="field">Display order<input type="number" value={f.sort} onChange={(e) => set('sort', e.target.value)} /></label>
        <div className="stack" style={{ justifyContent: 'flex-end' }}>
          <label className="check"><input type="checkbox" checked={!!f.higher_is_better} onChange={(e) => set('higher_is_better', e.target.checked ? 1 : 0)} />Higher is better (variance colours)</label>
          <label className="check"><input type="checkbox" checked={!!f.is_kpi} onChange={(e) => set('is_kpi', e.target.checked ? 1 : 0)} />Show as KPI tile on dashboard</label>
          {f.id && <label className="check"><input type="checkbox" checked={!!f.active} onChange={(e) => set('active', e.target.checked ? 1 : 0)} />Active</label>}
        </div>
      </div>
    </Modal>
  );
}

export default function Heads() {
  const { notify } = useApp();
  const [heads, setHeads] = useState(null);
  const [form, setForm] = useState(null);
  const [del, setDel] = useState(null);
  const load = () => api.get('/heads?all=1').then(setHeads).catch((e) => notify(e.message, 'err'));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <div className="topbar"><h2>Group heads</h2><span className="muted small">The standard lines everything consolidates into</span><div className="spacer" />
        <button className="primary" onClick={() => setForm({})}>+ New head</button></div>
      <div className="content stack">
        <div className="alert info">Companies keep their own line items. Each line maps to one <b>input</b> head here, so every company reports in its own
          format and the group view stays consistent. Group and formula heads (Gross profit, margins) are recalculated after consolidation, so ratios come out right.</div>
        {!heads ? <Spinner /> : (
          <div className="card"><div className="card-b flush tablewrap">
            <table className="t">
              <thead><tr><th>Head</th><th>Code</th><th>Type</th><th>Statement</th><th>Periods</th><th>Frequency</th><th className="num">Companies mapped</th><th /></tr></thead>
              <tbody>{heads.map((h) => (
                <tr key={h.id} className={`click ${h.head_type === 'section' ? 'sec' : h.head_type !== 'input' ? 'b' : ''}`} style={h.active ? undefined : { opacity: 0.5 }} onClick={() => setForm(h)}>
                  <td style={{ paddingLeft: 12 + h.depth * 18 }}>{h.name}{h.is_kpi ? <span className="tag" style={{ marginLeft: 6 }}>KPI</span> : null}</td>
                  <td><code>{h.code}</code></td>
                  <td>{h.head_type}{h.formula && <div className="faint small" style={{ fontFamily: 'Consolas, monospace' }}>= {h.formula}</div>}</td>
                  <td>{h.statement}</td><td>{h.nature}</td><td>{h.frequency}</td>
                  <td className="num">{h.head_type === 'input' ? h.mapped_companies : ''}</td>
                  <td className="num"><button className="ghost sm danger" onClick={(e) => { e.stopPropagation(); setDel(h); }}>Delete</button></td>
                </tr>
              ))}</tbody>
            </table>
          </div></div>
        )}
      </div>
      {form && heads && <HeadForm initial={form} heads={heads.filter((h) => h.active)} onClose={() => setForm(null)} onSaved={() => { setForm(null); load(); }} />}
      {del && <Confirm title={`Delete ${del.name}?`} danger confirmText="Delete" onClose={() => setDel(null)}
        message="Heads that are mapped, filed against, or used in formulas cannot be deleted. Deactivate them instead."
        onConfirm={async () => { try { await api.del(`/heads/${del.id}`); notify('Deleted'); load(); } catch (e) { notify(e.message, 'err'); throw e; } }} />}
    </>
  );
}
