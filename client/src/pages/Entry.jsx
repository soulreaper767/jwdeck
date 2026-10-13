import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApp } from '../store.jsx';
import { api } from '../lib/api.js';
import { parse, evaluate } from '../lib/formula.js';
import { fmtPlain, variance } from '../lib/format.js';
import { NodePicker, PeriodSelect, usePeriods } from '../components/ViewBar.jsx';
import { Seg, Spinner, Status, Confirm, Modal } from '../components/ui.jsx';

const parseNum = (s) => {
  if (s == null) return null;
  let t = String(s).trim().replace(/,/g, '');
  if (!t) return null;
  let neg = false;
  if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
  const n = Number(t);
  if (Number.isNaN(n)) return NaN;
  return neg ? -n : n;
};

function computeAll(lines, values) {
  const byCode = new Map(lines.map((l) => [l.code, l]));
  const out = new Map();
  const visiting = new Set();
  const calc = (l) => {
    if (out.has(l.id)) return out.get(l.id);
    if (visiting.has(l.id)) return null;
    visiting.add(l.id);
    let v = null;
    if (l.line_type === 'input') { const n = parseNum(values[l.id]); v = n == null || Number.isNaN(n) ? null : n; }
    else if (l.line_type === 'formula' && l.formula) {
      try {
        let any = false;
        v = evaluate(parse(l.formula), (c) => { const r = byCode.get(c); const x = r ? calc(r) : null; if (x != null) any = true; return x; });
        if (!any) v = null;
      } catch { v = null; }
    }
    visiting.delete(l.id);
    out.set(l.id, v);
    return v;
  };
  lines.forEach(calc);
  return out;
}

export default function Entry() {
  const params = useParams();
  const nav = useNavigate();
  const { user, nodes, view, setView, canEnter, isAdmin, notify } = useApp();
  const freq = params.freq || view.freq;
  const periods = usePeriods(freq);

  let companyId = Number(params.companyId) || null;
  if (!companyId) {
    if (user.role === 'company') companyId = user.node_id;
    else {
      const first = [...nodes.values()].find((n) => n.type === 'company' && n.active && canEnter(n.id));
      companyId = first?.id || null;
    }
  }
  const key = params.key || periods?.last_closed;

  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [values, setValues] = useState({});
  const [notes, setNotes] = useState({});
  const [remarks, setRemarks] = useState('');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [history, setHistory] = useState(null);
  const inputs = useRef({});

  const url = companyId && key ? `/entry/${companyId}/${freq}/${key}` : null;

  const load = useCallback(async () => {
    if (!url) return;
    setErr('');
    try {
      const r = await api.get(url);
      setData(r);
      const v = {};
      for (const [k, x] of Object.entries(r.values)) v[k] = x == null ? '' : fmtPlain(x, Math.abs(x % 1) > 0 ? 2 : 0);
      setValues(v);
      setNotes(r.notes || {});
      setRemarks(r.remarks || '');
      setDirty(false);
    } catch (e) { setErr(e.message); setData(null); }
  }, [url]);

  useEffect(() => { load(); }, [load]);

  const go = (cid, f, k) => {
    if (dirty && !window.confirm('You have unsaved changes. Leave without saving?')) return;
    if (f !== view.freq) setView({ freq: f });
    nav(`/entry/${cid}/${f}/${k || ''}`.replace(/\/$/, ''));
  };

  const lines = data?.lines || [];
  const computed = useMemo(() => computeAll(lines, values), [lines, values]);
  const inputLines = lines.filter((l) => l.line_type === 'input');
  const invalid = inputLines.filter((l) => Number.isNaN(parseNum(values[l.id])));

  const payload = () => ({
    values: inputLines.map((l) => ({ line_id: l.id, value: parseNum(values[l.id]), note: notes[l.id] || null })),
    remarks,
  });

  const save = async () => {
    if (invalid.length) return notify(`Fix invalid numbers: ${invalid.map((l) => l.label).join(', ')}`, 'err');
    setBusy(true);
    try { await api.put(url, payload()); notify('Draft saved'); await load(); } catch (e) { notify(e.message, 'err'); } finally { setBusy(false); }
  };
  const file = async () => {
    setBusy(true);
    try {
      const r = await api.post(`${url}/file`, payload());
      notify(`Filed and locked (revision ${r.revision})`);
      await load();
    } catch (e) { notify(e.message, 'err'); throw e; } finally { setBusy(false); }
  };
  const reopen = async (reason) => {
    try { await api.post(`${url}/reopen`, { reason }); notify('Reopened for correction'); await load(); } catch (e) { notify(e.message, 'err'); throw e; }
  };
  const showHistory = async () => setHistory(await api.get(`${url}/history`));

  const setVal = (id, v) => { setValues((x) => ({ ...x, [id]: v })); setDirty(true); };
  const onPaste = (e, idx) => {
    const text = e.clipboardData.getData('text');
    const parts = text.split(/\r?\n|\t/).map((s) => s.trim()).filter((s, i, a) => s !== '' || i < a.length - 1);
    if (parts.length < 2) return;
    e.preventDefault();
    const next = { ...values };
    parts.forEach((p, i) => { const l = inputLines[idx + i]; if (l) next[l.id] = p; });
    setValues(next);
    setDirty(true);
    notify(`Pasted ${Math.min(parts.length, inputLines.length - idx)} values`);
  };
  const onKey = (e, idx) => {
    if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); inputs.current[inputLines[idx + 1]?.id]?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); inputs.current[inputLines[idx - 1]?.id]?.focus(); }
  };

  const companyPicker = (
    <NodePicker value={companyId} placeholder="Pick a company" onChange={(cid) => go(cid, freq, key)}
      filter={(n, picking) => (picking ? n.type === 'company' : true)} />
  );
  const top = (
    <div className="topbar">
      {companyPicker}
      <Seg value={freq} options={[['monthly', 'Monthly'], ['weekly', 'Weekly']]} onChange={(f) => go(companyId, f, null)} />
      <PeriodSelect freq={freq} value={key} periods={periods} onChange={(k) => go(companyId, freq, k)} />
      <div className="spacer" />
      {data && <button onClick={showHistory}>History</button>}
      {data && <Link to={`/company/${companyId}`}><button>View report</button></Link>}
    </div>
  );

  if (!companyId) return <>{top}<div className="content"><div className="empty">No company assigned. Ask an administrator to give you access.</div></div></>;
  if (err) return <>{top}<div className="content"><div className="alert err">{err}</div></div></>;
  if (!data) return <>{top}<Spinner /></>;

  const c = data.comparatives;
  const ed = data.editable;
  const reopened = data.status === 'reopened';
  const filledCount = inputLines.filter((l) => parseNum(values[l.id]) != null).length;

  return (
    <>
      {top}
      <div className="content">
        <div className="grid" style={{ gridTemplateColumns: '220px minmax(0,1fr)', alignItems: 'start' }}>
          <div className="card">
            <div className="card-h"><h3>Recent {freq === 'weekly' ? 'weeks' : 'months'}</h3></div>
            <div style={{ padding: 6 }}>
              {data.recent.map((r) => (
                <div key={r.key} className={`tree`}><div className={`tn ${r.key === key ? 'sel' : ''}`} onClick={() => go(companyId, freq, r.key)}>
                  <span className="grow small">{freq === 'weekly' ? r.key : r.label}</span><Status status={r.status} />
                </div></div>
              ))}
            </div>
          </div>

          <div className="stack">
            <div className="page-head" style={{ marginBottom: 0 }}>
              <div>
                <div className="crumbs">{data.path.slice(0, -1).map((p) => p.name).join(' › ')}</div>
                <h1 style={{ marginTop: 4 }}>{data.company.name}</h1>
                <div className="sub">
                  {freq === 'weekly' ? 'Weekly' : 'Monthly'} figures · {data.period.label} · {data.company.currency} · due {data.due}
                </div>
              </div>
              <div className="spacer" />
              <Status status={data.status} overdue={data.status !== 'filed' && new Date() > new Date(data.due)} />
              {data.revision > 0 && <span className="badge">rev {data.revision}</span>}
            </div>

            {data.status === 'filed' && (
              <div className="alert ok">
                <span>🔒</span>
                <span className="grow">These figures are <b>filed and locked</b> (revision {data.revision}). They feed the consolidated results and become
                  the comparatives for later periods.{!isAdmin && ' Contact Group Finance if a correction is needed.'}</span>
                {data.can_reopen && <button className="sm" onClick={() => setConfirm('reopen')}>Reopen for correction</button>}
              </div>
            )}
            {reopened && (
              <div className="alert info"><span>✎</span><span>Reopened for correction. Until you file again, the group view keeps using
                revision {data.revision}. The column on the right shows those locked figures.</span></div>
            )}
            {data.not_started && <div className="alert warn">This period has not started yet.</div>}
            {!ed && data.status !== 'filed' && !data.not_started && <div className="alert warn">You can view these figures but not edit them.</div>}
            {lines.length === 0 && (
              <div className="alert warn">No {freq} reporting format is set up for this company yet.{isAdmin && <> <Link to={`/setup/formats/${companyId}/${freq}`}>Set it up →</Link></>}</div>
            )}

            {lines.length > 0 && (
              <div className="card entry">
                <div className="card-b flush tablewrap" style={{ maxHeight: 'calc(100vh - 330px)' }}>
                  <table className="t">
                    <thead>
                      <tr>
                        <th style={{ minWidth: 240 }}>Line</th>
                        <th className="num">{data.period.label.split(' (')[0]}</th>
                        <th>Note</th>
                        {reopened && <th className="num locked">Filed rev {c.last_filed?.revision}</th>}
                        <th className="num locked" title="Last filed, locked">{c.prev.label.split(' (')[0]} 🔒</th>
                        <th className="num">Δ</th>
                        <th className="num locked" title="Last filed, locked">{c.ly.label.split(' (')[0]} 🔒</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((l) => {
                        if (l.line_type === 'header') return <tr key={l.id} className="hdr"><td colSpan={reopened ? 7 : 6} style={{ paddingLeft: 12 + l.indent * 16 }}>{l.label}</td></tr>;
                        const idx = inputLines.indexOf(l);
                        const cur = computed.get(l.id);
                        const pv = c.prev.byId?.[l.id] ?? c.prev.byCode?.[l.code] ?? null;
                        const lv = c.ly.byId?.[l.id] ?? c.ly.byCode?.[l.code] ?? null;
                        const vp = variance(cur, pv);
                        const bad = l.line_type === 'input' && Number.isNaN(parseNum(values[l.id]));
                        return (
                          <tr key={l.id} className={`${l.bold || l.line_type === 'formula' ? 'b' : ''} ${l.required ? 'req' : ''}`}>
                            <td className="lbl" style={{ paddingLeft: 12 + l.indent * 16 }} title={l.formula ? `= ${l.formula}` : l.code}>
                              <span className="lblt">{l.label}</span>
                            </td>
                            {l.line_type === 'input' ? (
                              <td className="num">
                                {ed ? (
                                  <input className="val" value={values[l.id] ?? ''} ref={(el) => { inputs.current[l.id] = el; }}
                                    style={bad ? { borderColor: 'var(--bad)' } : undefined}
                                    onChange={(e) => setVal(l.id, e.target.value)} onPaste={(e) => onPaste(e, idx)} onKeyDown={(e) => onKey(e, idx)}
                                    onBlur={() => { const n = parseNum(values[l.id]); if (n != null && !Number.isNaN(n)) setValues((x) => ({ ...x, [l.id]: fmtPlain(n, Math.abs(n % 1) > 0 ? 2 : 0) })); }}
                                    placeholder="0" inputMode="decimal" />
                                ) : fmtPlain(cur, 0) || '–'}
                              </td>
                            ) : <td className="num calc">{cur == null ? '–' : fmtPlain(cur, 0)}</td>}
                            <td>
                              {l.line_type === 'input' && (ed
                                ? <input className="note" value={notes[l.id] || ''} placeholder="" onChange={(e) => { setNotes((x) => ({ ...x, [l.id]: e.target.value })); setDirty(true); }} />
                                : <span className="small muted">{notes[l.id]}</span>)}
                            </td>
                            {reopened && <td className="num locked">{fmtPlain(c.last_filed?.byId?.[l.id] ?? c.last_filed?.byCode?.[l.code], 0) || '–'}</td>}
                            <td className="num locked">{c.prev.missing ? <span className="faint">–</span> : fmtPlain(pv, 0) || '–'}</td>
                            <td className="num"><span className="delta flat">{vp.text}</span></td>
                            <td className="num locked">{c.ly.missing ? <span className="faint">–</span> : fmtPlain(lv, 0) || '–'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {lines.length > 0 && (
              <div className="card"><div className="card-b stack">
                <label className="field">Remarks / commentary for management
                  <textarea rows={2} value={remarks} disabled={!ed} onChange={(e) => { setRemarks(e.target.value); setDirty(true); }}
                    placeholder="Key reasons for movements, one-offs, etc." />
                </label>
                {ed && (
                  <div className="row">
                    <span className="muted small">{filledCount}/{inputLines.length} lines filled · Tip: paste a column from Excel into the first box · Enter moves down</span>
                    <div className="spacer" />
                    {dirty && <span className="small" style={{ color: 'var(--warn)' }}>Unsaved changes</span>}
                    <button onClick={save} disabled={busy}>Save draft</button>
                    <button className="primary" disabled={busy || invalid.length > 0} onClick={() => setConfirm('file')}>
                      {reopened ? 'Refile & lock' : 'File & lock'}
                    </button>
                  </div>
                )}
                {c.prev.missing && <div className="muted small">No locked filing for {c.prev.label}, so there is no previous-period comparative.</div>}
              </div></div>
            )}
          </div>
        </div>
      </div>

      {confirm === 'file' && (
        <Confirm title={reopened ? 'Refile figures' : 'File figures'} confirmText="File & lock" onClose={() => setConfirm(null)} onConfirm={file}
          message={<>You're about to file <b>{data.company.name}</b> figures for <b>{data.period.label}</b>. Once filed they are locked and feed the group
            consolidation. Only Group Finance can reopen them.</>} />
      )}
      {confirm === 'reopen' && (
        <Confirm title="Reopen filed figures" confirmText="Reopen" danger onClose={() => setConfirm(null)} onConfirm={reopen} input="Reason (kept in the audit log)"
          message={<>The consolidated view keeps using revision {data.revision} until the company files again.</>} />
      )}
      {history && (
        <Modal title={`Filing history · ${data.period.label}`} onClose={() => setHistory(null)} wide>
          {history.filings.length === 0 ? <div className="empty">Nothing filed yet.</div> : (
            <table className="t">
              <thead><tr><th>Line</th>{history.filings.map((f) => <th key={f.id} className="num">Rev {f.revision}<div className="faint" style={{ textTransform: 'none' }}>{f.filed_at.slice(0, 16)} · {f.filed_by || '—'}</div></th>)}</tr></thead>
              <tbody>
                {history.filings[0].lines.filter((l) => l.line_type !== 'header').map((l) => (
                  <tr key={l.id}><td>{l.label}</td>{history.filings.map((f) => {
                    const v = f.lines.find((x) => x.id === l.id || x.code === l.code)?.value;
                    const changed = f !== history.filings[history.filings.length - 1] && history.filings.some((g) => (g.lines.find((x) => x.id === l.id)?.value) !== v);
                    return <td key={f.id} className="num" style={changed ? { background: '#fff8e6' } : undefined}>{fmtPlain(v, 0) || '–'}</td>;
                  })}</tr>
                ))}
              </tbody>
            </table>
          )}
          {history.reopens.length > 0 && <div className="stack">
            <h3>Reopen log</h3>
            {history.reopens.map((r, i) => <div key={i} className="small"><b>{r.at}</b> · {r.name}: {r.detail.reason} (was rev {r.detail.revision})</div>)}
          </div>}
        </Modal>
      )}
    </>
  );
}
