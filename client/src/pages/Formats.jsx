import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useApp } from '../store.jsx';
import { api, qs } from '../lib/api.js';
import { NodePicker } from '../components/ViewBar.jsx';
import { Modal, Seg, Spinner } from '../components/ui.jsx';

let tmpId = 0;
const blank = () => ({ _k: `n${++tmpId}`, code: '', label: '', line_type: 'input', formula: '', head_id: null, sign: 1, indent: 0, bold: 0, required: 0 });

function TemplateModal({ freq, companyId, onClose, onLoad }) {
  const { notify } = useApp();
  const [src, setSrc] = useState('standard');
  const [from, setFrom] = useState(null);
  const [fromFreq, setFromFreq] = useState(freq);
  const go = async () => {
    try {
      const r = await api.get(`/formats/template${qs({ source: src, frequency: freq, company_id: from, from_frequency: fromFreq })}`);
      if (!r.length) return notify('Nothing to copy from there', 'err');
      onLoad(r);
    } catch (e) { notify(e.message, 'err'); }
  };
  return (
    <Modal title="Start from a template" onClose={onClose}
      footer={<><button onClick={onClose}>Cancel</button><button className="primary" disabled={src === 'company' && !from} onClick={go}>Load into editor</button></>}>
      <Seg value={src} options={[['standard', 'Group heads'], ['company', 'Another company']]} onChange={setSrc} />
      {src === 'standard'
        ? <div className="muted">Creates one line per group head, already mapped, with subtotal formulas. Rename and adjust lines to match the company's own format.</div>
        : <div className="stack">
          <NodePicker value={from} onChange={setFrom} placeholder="Pick company" filter={(n, picking) => (picking ? n.type === 'company' && n.id !== companyId : true)} />
          <Seg value={fromFreq} options={[['monthly', 'Its monthly format'], ['weekly', 'Its weekly format']]} onChange={setFromFreq} />
        </div>}
      <div className="alert warn">This replaces the lines in the editor. Nothing is saved until you click Save. Lines that already hold figures are kept in history.</div>
    </Modal>
  );
}

export default function Formats() {
  const params = useParams();
  const nav = useNavigate();
  const { nodes, notify } = useApp();
  const companyId = Number(params.companyId) || [...nodes.values()].find((n) => n.type === 'company')?.id;
  const freq = params.freq || 'monthly';
  const [heads, setHeads] = useState([]);
  const [lines, setLines] = useState(null);
  const [warnings, setWarnings] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [tpl, setTpl] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.get('/heads').then(setHeads).catch(() => {}); }, []);
  useEffect(() => {
    if (!companyId) return;
    setLines(null);
    api.get(`/formats/${companyId}/${freq}`).then((r) => {
      setLines(r.lines.map((l) => ({ ...l, _k: `e${l.id}` })));
      setWarnings(r.warnings);
      setDirty(false);
    }).catch((e) => notify(e.message, 'err'));
  }, [companyId, freq, notify]);

  const go = (cid, f) => {
    if (dirty && !window.confirm('Discard unsaved format changes?')) return;
    nav(`/setup/formats/${cid}/${f}`);
  };
  const upd = (i, patch) => { setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l))); setDirty(true); };
  const move = (i, d) => {
    setLines((ls) => { const n = [...ls]; const j = i + d; if (j < 0 || j >= n.length) return ls; [n[i], n[j]] = [n[j], n[i]]; return n; });
    setDirty(true);
  };
  const remove = (i) => { setLines((ls) => ls.filter((_, j) => j !== i)); setDirty(true); };
  const insert = (i) => { setLines((ls) => [...ls.slice(0, i + 1), blank(), ...ls.slice(i + 1)]); setDirty(true); };

  const save = async () => {
    setBusy(true);
    try {
      const r = await api.put(`/formats/${companyId}/${freq}`, { lines });
      setLines(r.lines.map((l) => ({ ...l, _k: `e${l.id}` })));
      setWarnings(r.warnings);
      setDirty(false);
      notify('Format saved');
    } catch (e) { notify(e.message, 'err'); } finally { setBusy(false); }
  };

  const inputHeads = heads.filter((h) => h.head_type === 'input' && (h.frequency === 'both' || h.frequency === freq));
  const company = nodes.get(companyId);

  return (
    <>
      <div className="topbar">
        <NodePicker value={companyId} onChange={(cid) => go(cid, freq)} placeholder="Pick company" filter={(n, picking) => (picking ? n.type === 'company' : true)} />
        <Seg value={freq} options={[['monthly', 'Monthly format'], ['weekly', 'Weekly format']]} onChange={(f) => go(companyId, f)} />
        <div className="spacer" />
        <button onClick={() => setTpl(true)}>Load template…</button>
        <button className="primary" disabled={!dirty || busy} onClick={save}>{busy ? 'Saving…' : 'Save format'}</button>
      </div>
      <div className="content stack">
        <div className="page-head" style={{ marginBottom: 0 }}>
          <div>
            <h1>{company?.name} · {freq} reporting format</h1>
            <div className="sub">The company's own lines, labels and subtotals. Map each figure line to a group head for consolidation. Reporting currency: {company?.currency}.</div>
          </div>
        </div>
        {warnings.length > 0 && !dirty && (
          <div className="alert warn"><div>{warnings.map((w, i) => <div key={i}>• {w.msg}</div>)}</div></div>
        )}
        {!lines ? <Spinner /> : (
          <div className="card">
            <div className="card-b flush" style={{ overflowX: 'auto' }}>
              <table className="t">
                <thead>
                  <tr>
                    <th style={{ width: 60 }} />
                    <th style={{ width: 110 }}>Code</th>
                    <th>Label (as the company calls it)</th>
                    <th style={{ width: 110 }}>Type</th>
                    <th style={{ minWidth: 220 }}>Maps to group head / formula</th>
                    <th style={{ width: 70 }} title="Multiply by −1 when consolidating, e.g. if the company records costs as negatives">Sign</th>
                    <th style={{ width: 60 }}>Indent</th>
                    <th style={{ width: 44 }} title="Bold">B</th>
                    <th style={{ width: 44 }} title="Required before filing">Req</th>
                    <th style={{ width: 80 }} />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={l._k} className={l.line_type === 'header' ? 'hdr' : ''}>
                      <td><button className="ghost icon sm" onClick={() => move(i, -1)}>↑</button><button className="ghost icon sm" onClick={() => move(i, 1)}>↓</button></td>
                      <td><input value={l.code} onChange={(e) => upd(i, { code: e.target.value.toUpperCase() })} style={{ width: 100, fontFamily: 'Consolas, monospace', fontSize: 12 }} /></td>
                      <td><input value={l.label} onChange={(e) => upd(i, { label: e.target.value })} style={{ width: '100%', minWidth: 220, paddingLeft: 9 + l.indent * 14, fontWeight: l.bold ? 600 : 400 }} /></td>
                      <td>
                        <select value={l.line_type} onChange={(e) => upd(i, { line_type: e.target.value })}>
                          <option value="input">Figure</option><option value="formula">Subtotal</option><option value="header">Heading</option>
                        </select>
                      </td>
                      <td>
                        {l.line_type === 'formula' && (
                          <input value={l.formula || ''} onChange={(e) => upd(i, { formula: e.target.value.toUpperCase() })} placeholder="e.g. S1 + S2 - C1"
                            style={{ width: '100%', fontFamily: 'Consolas, monospace', fontSize: 12, marginBottom: 4 }} />
                        )}
                        {l.line_type !== 'header' && (
                          <select value={l.head_id || ''} onChange={(e) => upd(i, { head_id: e.target.value ? Number(e.target.value) : null })}
                            style={{ width: '100%', borderColor: l.line_type === 'input' && !l.head_id ? 'var(--warn)' : undefined }}>
                            <option value="">{l.line_type === 'formula' ? '(not consolidated: calculated only)' : '— not mapped —'}</option>
                            {inputHeads.map((h) => <option key={h.id} value={h.id}>{h.code} · {h.name}</option>)}
                          </select>
                        )}
                      </td>
                      <td>{l.line_type !== 'header' && <select value={l.sign} onChange={(e) => upd(i, { sign: Number(e.target.value) })}><option value={1}>+</option><option value={-1}>−</option></select>}</td>
                      <td><input type="number" min={0} max={4} value={l.indent} onChange={(e) => upd(i, { indent: Number(e.target.value) })} style={{ width: 50 }} /></td>
                      <td><input type="checkbox" checked={!!l.bold} onChange={(e) => upd(i, { bold: e.target.checked ? 1 : 0 })} /></td>
                      <td>{l.line_type === 'input' && <input type="checkbox" checked={!!l.required} onChange={(e) => upd(i, { required: e.target.checked ? 1 : 0 })} />}</td>
                      <td className="num">
                        <button className="ghost icon sm" title="Insert line below" onClick={() => insert(i)}>＋</button>
                        <button className="ghost icon sm danger" title={l.has_values ? 'Has figures: will be retired, history kept' : 'Remove'} onClick={() => remove(i)}>✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {lines.length === 0 && <div className="empty">No lines yet. Load a template or add lines.</div>}
            </div>
            <div className="card-b row">
              <button onClick={() => insert(lines.length - 1)}>+ Add line</button>
              <span className="muted small">Subtotal formulas use this company's line codes. Mapped subtotals are fine, but don't map a subtotal and its parts together or they'll be counted twice.</span>
            </div>
          </div>
        )}
      </div>
      {tpl && <TemplateModal freq={freq} companyId={companyId} onClose={() => setTpl(false)}
        onLoad={(ls) => { setLines(ls.map((l) => ({ ...blank(), ...l, _k: `t${++tmpId}` }))); setDirty(true); setTpl(false); }} />}
    </>
  );
}
