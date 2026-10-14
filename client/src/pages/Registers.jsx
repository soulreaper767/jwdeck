import { useCallback, useEffect, useState } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell, LabelList } from 'recharts';
import { useApp } from '../store.jsx';
import { api } from '../lib/api.js';
import { fv, parseNum, plainNum } from '../lib/format.js';
import { NodeSelect, Seg, Loading, Modal, Logo, PrintButton, PrintHeader } from '../ui.jsx';
import { C, KpiCard, ChartCard } from './Overview.jsx';

const STAGE = { lead: 'Lead', proposal: 'Proposal', negotiation: 'Negotiation', awaiting: 'Awaiting confirmation', won: 'Won', lost: 'Lost' };
const STAGE_C = { lead: '#9AA5CE', proposal: '#118DFF', negotiation: '#744EC2', awaiting: '#E66C37', won: C.pos, lost: C.neg };
const STATUS = { planned: 'Planned', in_progress: 'In progress', done: 'Done', dropped: 'Dropped' };
const STATUS_C = { planned: '#9AA5CE', in_progress: '#118DFF', done: C.pos, dropped: '#A19F9D' };
const today = () => new Date().toISOString().slice(0, 10);

// selected node: a company (editable register) or a cluster / group (consolidated, read-only)
function useNode() {
  const { nodes, view, user } = useApp();
  const fallback = user.role === 'company_dpo' || user.role === 'company_reviewer'
    ? [...nodes.values()].find((n) => n.type === 'company')?.id : view.nodeId;
  const [id, setId] = useState(null);
  const sel = id || fallback;
  return [sel, setId, nodes.get(sel)?.type === 'company'];
}

// load either one company's register or the consolidated one
function useRegister(kind, id, isCompany, notify) {
  const [d, setD] = useState(null);
  const load = useCallback(() => {
    if (!id) return;
    api.get(isCompany ? `/${kind}/${id}` : `/registers/${kind}/node/${id}`).then((r) => setD({ ...r, consolidated: !isCompany, company: r.company || r.node })).catch((e) => notify(e.message, 'err'));
  }, [kind, id, isCompany, notify]);
  useEffect(() => { setD(null); load(); }, [load]);
  return [d, load];
}

function OppForm({ init, onClose, onSave }) {
  const [f, setF] = useState({ stage: 'lead', created_on: today(), ...init, value: plainNum(init.value) });
  const s = (k, v) => setF({ ...f, [k]: v });
  return (
    <Modal title={init.uid ? init.customer : 'New opportunity'} onClose={onClose}>
      <div className="form2">
        <label className="f">Customer<input value={f.customer || ''} onChange={(e) => s('customer', e.target.value)} autoFocus /></label>
        <label className="f">Description<input value={f.title || ''} onChange={(e) => s('title', e.target.value)} /></label>
        <label className="f">Value (PKR)<input className="n" value={f.value || ''} onChange={(e) => s('value', e.target.value)} onBlur={() => s('value', plainNum(parseNum(f.value)))} /></label>
        <label className="f">Stage<select value={f.stage} onChange={(e) => s('stage', e.target.value)}>{Object.entries(STAGE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="f">Opened on<input type="date" value={f.created_on || ''} onChange={(e) => s('created_on', e.target.value)} /></label>
        <label className="f">Expected close<input type="date" value={f.expected_close || ''} onChange={(e) => s('expected_close', e.target.value)} /></label>
        {(f.stage === 'won' || f.stage === 'lost') && <label className="f">Closed on<input type="date" value={f.closed_on || today()} onChange={(e) => s('closed_on', e.target.value)} /></label>}
        <label className="f">Probability %<input type="number" min={0} max={100} value={f.probability ?? ''} onChange={(e) => s('probability', e.target.value)} /></label>
        <label className="f">Owner<input value={f.owner || ''} onChange={(e) => s('owner', e.target.value)} /></label>
        <label className="f" style={{ gridColumn: '1 / -1' }}>Notes<textarea rows={2} value={f.notes || ''} onChange={(e) => s('notes', e.target.value)} /></label>
      </div>
      <div className="row"><span className="sp" /><button onClick={onClose}>Cancel</button><button className="dark" onClick={() => onSave({ ...f, value: parseNum(f.value) || 0, closed_on: f.closed_on || (['won', 'lost'].includes(f.stage) ? today() : null) })}>Save</button></div>
    </Modal>
  );
}

export function Pipeline() {
  const { notify, view } = useApp();
  const [cid, setCid, isCompany] = useNode();
  const [d, load] = useRegister('opps', cid, isCompany, notify);
  const [form, setForm] = useState(null);
  const [filter, setFilter] = useState('open');
  const unit = view.unit;
  if (!d) return <><div className="bar"><NodeSelect value={cid} onChange={setCid} /></div><Loading /></>;

  const rows = d.rows;
  const open = rows.filter((r) => !['won', 'lost'].includes(r.stage));
  const month = today().slice(0, 7);
  const wonM = rows.filter((r) => r.stage === 'won' && r.closed_on?.startsWith(month));
  const closed = rows.filter((r) => ['won', 'lost'].includes(r.stage));
  const winRate = closed.length ? (rows.filter((r) => r.stage === 'won').length / closed.length) * 100 : null;
  const sum = (l) => l.reduce((a, r) => a + (r.value || 0), 0);
  const weighted = open.reduce((a, r) => a + (r.value || 0) * ((r.probability ?? 0) / 100), 0);
  const funnel = Object.keys(STAGE).map((k) => ({ stage: STAGE[k], key: k, value: sum(rows.filter((r) => r.stage === k)), n: rows.filter((r) => r.stage === k).length }));
  const shown = rows.filter((r) => (filter === 'open' ? !['won', 'lost'].includes(r.stage) : filter === 'all' ? true : r.stage === filter));
  const save = async (f) => { try { await api.put(`/opps/${cid}/${f.uid || 'new'}`, f); setForm(null); load(); notify('Saved'); } catch (e) { notify(e.message, 'err'); } };

  return (
    <>
      <div className="bar">
        <NodeSelect value={cid} onChange={setCid} />
        <span className="sp" />
        {d.editable && <button className="dark" onClick={() => setForm({})}>New opportunity</button>}
        <PrintButton />
      </div>
      <div className="dash">
        <PrintHeader node={d.company} title={d.consolidated ? 'Consolidated pipeline' : 'Pipeline'} />
        <div className="title"><Logo node={d.company} /><h1>{d.company.name}</h1><span className="meta">{d.consolidated ? 'Consolidated pipeline' : 'Pipeline'}</span></div>
        <div className="kgrid">
          <KpiCard title="Open pipeline" actual={sum(open)} unit={unit} foot={`${open.length} opportunities · weighted ${fv(weighted, 'amount', unit)}`} />
          <KpiCard title="Awaiting confirmation" actual={sum(rows.filter((r) => r.stage === 'awaiting'))} unit={unit} foot={`${rows.filter((r) => r.stage === 'awaiting').length} orders`} />
          <KpiCard title="Won this month" actual={sum(wonM)} unit={unit} foot={`${wonM.length} orders`} />
          <KpiCard title="Win rate" actual={winRate} fmt="percent" unit={unit} foot={`${closed.length} closed`} />
        </div>
        <div className="cgrid" style={{ marginTop: 16 }}>
          {d.consolidated && d.companies.length > 0 && (
            <ChartCard title="Open pipeline by company" sub="Open value · awaiting confirmation · won this month" h={Math.max(200, d.companies.length * 44 + 40)}>
              <ResponsiveContainer>
                <BarChart data={d.companies.map((c) => {
                  const mine = rows.filter((r) => r.company_id === c.id);
                  return { name: c.name, open: sum(mine.filter((r) => !['won', 'lost'].includes(r.stage))), awaiting: sum(mine.filter((r) => r.stage === 'awaiting')), won: sum(mine.filter((r) => r.stage === 'won' && r.closed_on?.startsWith(month))) };
                })} layout="vertical" margin={{ top: 4, right: 20, left: 8, bottom: 0 }}>
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 12.5, fill: '#252423' }} axisLine={false} tickLine={false} />
                  <Tooltip formatter={(v) => fv(v, 'amount', unit)} contentStyle={{ fontFamily: 'Times New Roman' }} />
                  <Bar dataKey="open" name="Open" fill="#118DFF" isAnimationActive={false} barSize={9} radius={2} />
                  <Bar dataKey="awaiting" name="Awaiting" fill={STAGE_C.awaiting} isAnimationActive={false} barSize={9} radius={2} />
                  <Bar dataKey="won" name="Won this month" fill={STAGE_C.won} isAnimationActive={false} barSize={9} radius={2} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          )}
          <ChartCard title="Pipeline by stage" sub="Value of opportunities in each stage" h={240}>
            <ResponsiveContainer>
              <BarChart data={funnel} layout="vertical" margin={{ top: 4, right: 60, left: 8, bottom: 0 }}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="stage" width={150} tick={{ fontSize: 12.5, fill: '#252423' }} axisLine={false} tickLine={false} />
                <Tooltip formatter={(v) => fv(v, 'amount', unit)} contentStyle={{ fontFamily: 'Times New Roman' }} />
                <Bar dataKey="value" isAnimationActive={false} barSize={18} radius={3}>
                  {funnel.map((f) => <Cell key={f.key} fill={STAGE_C[f.key]} />)}
                  <LabelList dataKey="value" position="right" formatter={(v) => fv(v, 'amount', unit)} style={{ fontSize: 12 }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>
        <div className="row" style={{ marginTop: 18 }}>
          <h2 className="part" style={{ margin: 0 }}>Opportunities</h2><span className="sp" />
          <Seg value={filter} options={[['open', 'Open'], ['awaiting', 'Awaiting'], ['won', 'Won'], ['lost', 'Lost'], ['all', 'All']]} onChange={setFilter} />
        </div>
        <div className="cc" style={{ marginTop: 8 }}>
          <div className="wrap">
            <table className="r pbi">
              <thead><tr>{d.consolidated && <th className="l">Company</th>}<th className="l">Customer</th><th className="l">Description</th><th>Value</th><th>Stage</th><th>Prob.</th><th>Opened</th><th>Expected close</th><th>Closed</th><th className="l">Owner</th><th /></tr></thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.uid} className={d.editable ? 'click' : ''} onClick={() => d.editable && setForm(r)}>
                    {d.consolidated && <td className="l mute">{r.company}</td>}
                    <td className="l">{r.customer}</td><td className="l mute">{r.title}</td>
                    <td className="n">{fv(r.value, 'amount', '1')}</td>
                    <td style={{ textAlign: 'center' }}><span className="stage" style={{ background: STAGE_C[r.stage] }}>{STAGE[r.stage]}</span></td>
                    <td className="n">{r.probability != null ? `${r.probability}%` : ''}</td>
                    <td className="n">{r.created_on}</td><td className="n">{r.expected_close || ''}</td><td className="n">{r.closed_on || ''}</td>
                    <td className="l">{r.owner}</td>
                    <td className="n">{d.editable && <button className="link small" onClick={async (e) => { e.stopPropagation(); if (window.confirm('Remove this opportunity?')) { await api.del(`/opps/${cid}/${r.uid}`); load(); } }}>remove</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!shown.length && <div className="empty">None.</div>}
          </div>
        </div>
      </div>
      {form && <OppForm init={form} onClose={() => setForm(null)} onSave={save} />}
    </>
  );
}

function InitForm({ init, onClose, onSave }) {
  const [f, setF] = useState({ status: 'planned', start_date: today(), progress: 0, ...init });
  const s = (k, v) => setF({ ...f, [k]: v });
  return (
    <Modal title={init.uid ? init.title : 'New initiative'} onClose={onClose}>
      <div className="form2">
        <label className="f" style={{ gridColumn: '1 / -1' }}>Initiative<input value={f.title || ''} onChange={(e) => s('title', e.target.value)} autoFocus /></label>
        <label className="f">Owner<input value={f.owner || ''} onChange={(e) => s('owner', e.target.value)} /></label>
        <label className="f">Status<select value={f.status} onChange={(e) => s('status', e.target.value)}>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="f">Start<input type="date" value={f.start_date || ''} onChange={(e) => s('start_date', e.target.value)} /></label>
        <label className="f">Target date<input type="date" value={f.target_date || ''} onChange={(e) => s('target_date', e.target.value)} /></label>
        <label className="f">Progress %<input type="number" min={0} max={100} value={f.progress ?? 0} onChange={(e) => s('progress', e.target.value)} /></label>
        <label className="f" style={{ gridColumn: '1 / -1' }}>Milestones / notes<textarea rows={3} value={f.notes || ''} onChange={(e) => s('notes', e.target.value)} /></label>
      </div>
      <div className="row"><span className="sp" /><button onClick={onClose}>Cancel</button><button className="dark" onClick={() => onSave(f)}>Save</button></div>
    </Modal>
  );
}

export function Initiatives() {
  const { notify } = useApp();
  const [cid, setCid, isCompany] = useNode();
  const [d, load] = useRegister('inits', cid, isCompany, notify);
  const [form, setForm] = useState(null);
  if (!d) return <><div className="bar"><NodeSelect value={cid} onChange={setCid} /></div><Loading /></>;
  const by = (k) => d.rows.filter((r) => r.status === k).length;
  const save = async (f) => { try { await api.put(`/inits/${cid}/${f.uid || 'new'}`, f); setForm(null); load(); notify('Saved'); } catch (e) { notify(e.message, 'err'); } };
  const late = (r) => r.target_date && r.target_date < today() && !['done', 'dropped'].includes(r.status);
  return (
    <>
      <div className="bar">
        <NodeSelect value={cid} onChange={setCid} />
        <span className="sp" />
        {d.editable && <button className="dark" onClick={() => setForm({})}>New initiative</button>}
        <PrintButton />
      </div>
      <div className="dash">
        <PrintHeader node={d.company} title={d.consolidated ? 'Consolidated strategic initiatives' : 'Strategic initiatives'} />
        <div className="title"><Logo node={d.company} /><h1>{d.company.name}</h1><span className="meta">{d.consolidated ? 'Consolidated strategic initiatives' : 'Strategic initiatives'}</span></div>
        <div className="kgrid">
          <KpiCard title="In progress" actual={by('in_progress')} fmt="number" />
          <KpiCard title="Planned" actual={by('planned')} fmt="number" />
          <KpiCard title="Done" actual={by('done')} fmt="number" />
          <KpiCard title="Past target date" actual={d.rows.filter(late).length} fmt="number" />
        </div>
        {d.consolidated && d.companies.length > 0 && (
          <div className="cc" style={{ marginTop: 16 }}>
            <div className="cc-h"><span className="cc-t">By company</span></div>
            <table className="r pbi">
              <thead><tr><th className="l">Company</th>{Object.values(STATUS).map((s) => <th key={s}>{s}</th>)}<th>Past target</th><th>Average progress</th></tr></thead>
              <tbody>{d.companies.map((c) => {
                const mine = d.rows.filter((r) => r.company_id === c.id);
                const live = mine.filter((r) => r.status !== 'dropped');
                return (
                  <tr key={c.id} className="click" onClick={() => setCid(c.id)}>
                    <td className="l">{c.name}</td>
                    {Object.keys(STATUS).map((k) => <td key={k} className="n">{mine.filter((r) => r.status === k).length || ''}</td>)}
                    <td className={`n ${mine.filter(late).length ? 'bad' : ''}`}>{mine.filter(late).length || ''}</td>
                    <td><div className="prog"><i style={{ width: `${live.length ? live.reduce((a, r) => a + (r.progress || 0), 0) / live.length : 0}%`, background: '#118DFF' }} /><span>{live.length ? Math.round(live.reduce((a, r) => a + (r.progress || 0), 0) / live.length) : 0}%</span></div></td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        )}
        <div className="cc" style={{ marginTop: 16 }}>
          <div className="wrap">
            <table className="r pbi">
              <thead><tr>{d.consolidated && <th className="l">Company</th>}<th className="l">Initiative</th><th className="l">Owner</th><th>Status</th><th>Start</th><th>Target</th><th style={{ minWidth: 160 }}>Progress</th><th /></tr></thead>
              <tbody>
                {d.rows.map((r) => (
                  <tr key={r.uid} className={d.editable ? 'click' : ''} onClick={() => d.editable && setForm(r)}>
                    {d.consolidated && <td className="l mute">{r.company}</td>}
                    <td className="l">{r.title}{r.notes ? <div className="small mute">{r.notes}</div> : null}</td>
                    <td className="l">{r.owner}</td>
                    <td style={{ textAlign: 'center' }}><span className="stage" style={{ background: STATUS_C[r.status] }}>{STATUS[r.status]}</span></td>
                    <td className="n">{r.start_date}</td>
                    <td className={`n ${late(r) ? 'bad' : ''}`}>{r.target_date || ''}</td>
                    <td><div className="prog"><i style={{ width: `${r.progress || 0}%`, background: STATUS_C[r.status] }} /><span>{r.progress || 0}%</span></div></td>
                    <td className="n">{d.editable && <button className="link small" onClick={async (e) => { e.stopPropagation(); if (window.confirm('Remove this initiative?')) { await api.del(`/inits/${cid}/${r.uid}`); load(); } }}>remove</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!d.rows.length && <div className="empty">None.</div>}
          </div>
        </div>
      </div>
      {form && <InitForm init={form} onClose={() => setForm(null)} onSave={save} />}
    </>
  );
}
