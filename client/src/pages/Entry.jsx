import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useApp } from '../store.jsx';
import { api } from '../lib/api.js';
import { fv, vr, fpct, parseNum, plainNum, STATUS } from '../lib/format.js';
import { NodeSelect, WeekSelect, Seg, Loading, Ask, Modal } from '../ui.jsx';

const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthName = (m) => (m ? `${MN[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}` : '');

const toStr = (d) => {
  const v = {};
  for (const [item, byM] of Object.entries(d.values || {})) for (const [m, x] of Object.entries(byM)) (v[item] ||= {})[m] = plainNum(x);
  const a = {};
  for (const [item, x] of Object.entries(d.adj || {})) a[item] = { value: plainNum(x.value), reason: x.reason || '' };
  return { values: v, adj: a, notes: { ...(d.notes || {}) }, remarks: d.remarks || '' };
};
const toNum = (s) => {
  const values = {};
  for (const [item, byM] of Object.entries(s.values)) for (const [m, x] of Object.entries(byM)) { const n = parseNum(x); if (n != null && !Number.isNaN(n)) (values[item] ||= {})[m] = n; }
  const adj = {};
  for (const [item, x] of Object.entries(s.adj)) { const n = parseNum(x.value); if (n) adj[item] = { value: n, reason: x.reason }; }
  return { values, adj, notes: s.notes, remarks: s.remarks };
};

function Setup({ cid, onDone }) {
  const { notify } = useApp();
  const [info, setInfo] = useState(null);
  const [week, setWeek] = useState('');
  const [cash, setCash] = useState('');
  useEffect(() => { api.get(`/companies/${cid}/setup`).then((r) => { setInfo(r); setWeek(r.setup?.start_week || r.suggested_start); setCash(plainNum(r.setup?.opening_cash)); }); }, [cid]);
  if (!info) return <Loading />;
  const save = async () => {
    try { await api.put(`/companies/${cid}/setup`, { start_week: week, opening_cash: parseNum(cash) }); notify('Saved'); onDone(); } catch (e) { notify(e.message, 'err'); }
  };
  return (
    <div className="box" style={{ maxWidth: 560 }}>
      <h2 style={{ marginBottom: 10 }}>Opening position</h2>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <label className="f">First reporting week<WeekSelect value={week} onChange={setWeek} /></label>
        <label className="f">Cash & bank at start of that week (PKR)<input className="n" value={cash} onChange={(e) => setCash(e.target.value)} onBlur={() => setCash(plainNum(parseNum(cash)))} style={{ width: 190 }} /></label>
        <button className="dark" disabled={!info.can_edit_opening} onClick={save}>Save</button>
      </div>
      <div style={{ marginTop: 12 }} className="small">SKUs: {info.skus.filter((s) => s.active).map((s) => s.name).join(', ') || 'none'} · <Link to={`/companies?c=${cid}`}>edit</Link></div>
    </div>
  );
}

export default function Entry() {
  const params = useParams();
  const nav = useNavigate();
  const { user, nodes, view, canEnter, notify, isAdmin } = useApp();
  let cid = Number(params.cid) || null;
  if (!cid) cid = user.role === 'company' ? user.node_id : [...nodes.values()].find((n) => n.type === 'company' && canEnter(n.id))?.id || null;
  const week = params.week || view.week;

  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [s, setS] = useState(null);
  const [pv, setPv] = useState(null);
  const [month, setMonth] = useState(null);
  const [openAdj, setOpenAdj] = useState(() => new Set());
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState(null);
  const [hist, setHist] = useState(null);
  const refs = useRef({});
  const timer = useRef(null);
  const url = cid && week ? `/report/${cid}/${week}` : null;

  const load = useCallback(async () => {
    if (!url) return;
    setErr('');
    try {
      const r = await api.get(url);
      setD(r);
      setS(toStr(r.data));
      setPv(r.preview);
      setMonth((m) => (r.week.segments.some((x) => x.month === m) ? m : r.week.segments[r.week.segments.length - 1].month));
      setOpenAdj(new Set([...Object.keys(r.data.adj || {}), ...Object.keys(r.data.notes || {})]));
      setDirty(false);
    } catch (e) { setErr(e.message); setD(null); }
  }, [url]);
  useEffect(() => { load(); }, [load]);

  const go = (c, w) => {
    if (dirty && !window.confirm('Discard unsaved figures?')) return;
    nav(`/enter/${c}/${w}`);
  };

  const change = (fn) => {
    setS((cur) => {
      const next = fn(structuredClone(cur));
      clearTimeout(timer.current);
      timer.current = setTimeout(() => { api.post(`${url}/preview`, toNum(next)).then(setPv).catch(() => {}); }, 350);
      return next;
    });
    setDirty(true);
  };

  const segs = d?.week.segments || [];
  const inputCodes = useMemo(() => new Set((d?.lines || []).filter((l) => l.kind === 'input').map((l) => l.code)), [d]);
  const noteCodes = useMemo(() => new Set((d?.lines || []).filter((l) => l.note_required).map((l) => l.code)), [d]);
  const isInput = (code) => inputCodes.has(code) || /^SKU:\d+:(PQ|SQ|SV)$/.test(code);
  const sections = pv?.[month] || null;
  const order = useMemo(() => (sections ? sections.flatMap((x) => x.rows).filter((r) => r.code && isInput(r.code)).map((r) => r.code) : []), [sections]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    setBusy(true);
    try { await api.put(url, toNum(s)); notify('Saved'); setDirty(false); } catch (e) { notify(e.message, 'err'); } finally { setBusy(false); }
  };
  const file = async () => {
    setBusy(true);
    try { const r = await api.post(`${url}/file`, toNum(s)); notify(`Filed · rev ${r.revision}`); await load(); } catch (e) { notify(e.message, 'err'); } finally { setBusy(false); }
  };

  const onKey = (e, code, m) => {
    const segIdx = segs.findIndex((x) => x.month === m);
    const i = order.indexOf(code);
    const focus = (c2, m2) => refs.current[`${c2}|${m2}`]?.focus();
    if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); if (order[i + 1]) focus(order[i + 1], m); }
    if (e.key === 'ArrowUp') { e.preventDefault(); if (order[i - 1]) focus(order[i - 1], m); }
    if (e.key === 'ArrowRight' && segs[segIdx + 1] && e.target.selectionStart === e.target.value.length) focus(code, segs[segIdx + 1].month);
    if (e.key === 'ArrowLeft' && segIdx > 0 && e.target.selectionStart === 0) focus(code, segs[segIdx - 1].month);
  };
  const onPaste = (e, code, m) => {
    const parts = e.clipboardData.getData('text').split(/\r?\n/).filter((x, i, a) => x !== '' || i < a.length - 1);
    if (parts.length < 2 && !parts[0]?.includes('\t')) return;
    e.preventDefault();
    const i = order.indexOf(code);
    const si = segs.findIndex((x) => x.month === m);
    change((st) => {
      parts.forEach((line, k) => line.split('\t').forEach((cell, j) => {
        const c2 = order[i + k];
        const m2 = segs[si + j]?.month;
        if (c2 && m2) (st.values[c2] ||= {})[m2] = cell.trim();
      }));
      return st;
    });
  };

  const top = (
    <div className="bar">
      <NodeSelect value={cid} companiesOnly onChange={(c) => go(c, week)} />
      <WeekSelect value={week} onChange={(w) => go(cid, w)} from={d?.setup?.start_week} />
      {segs.length > 1 && <Seg value={month} options={segs.map((x) => [x.month, `MTD ${x.label}`])} onChange={setMonth} />}
      <span className="sp" />
      {d?.revision > 0 && <button onClick={async () => setHist(await api.get(`${url}/history`))}>History</button>}
    </div>
  );

  if (!cid) return <>{top}<div className="empty">No company assigned.</div></>;
  if (err) return <>{top}<div className="note err">{err}</div></>;
  if (!d || !s) return <>{top}<Loading /></>;

  const ed = d.editable;
  const fileBlock = d.not_ended ? 'Week not ended' : d.unfiled.length ? `File first: ${d.unfiled.join(', ')}` : '';
  const cols = 1 + segs.length + 9 + 2;

  return (
    <>
      {top}
      <div className="title">
        <h1>{d.company.name}</h1>
        <span className="meta">{d.week.label} · due {d.due} · {STATUS[d.status]}{d.revision ? ` · rev ${d.revision}` : ''}</span>
        <span className="sp" />
        {d.can_reopen && <button onClick={() => setAsk('reopen')}>Reopen</button>}
      </div>

      {d.needs_setup || d.before_start ? (
        canEnter(cid) || isAdmin ? <Setup cid={cid} onDone={load} /> : <div className="empty">Reporting not started.</div>
      ) : (
        <>
          {d.status === 'reopened' && <div className="note warn">Reopened · group figures still use rev {d.revision} until filed again</div>}
          {d.status !== 'filed' && d.unfiled.length > 0 && <div className="note warn">Earlier weeks not filed: {d.unfiled.map((w) => <Link key={w} to={`/enter/${cid}/${w}`} style={{ marginRight: 8 }}>{w}</Link>)}</div>}
          {!sections ? <Loading /> : (
            <div className="wrap entry">
              <table className="r">
                <thead>
                  <tr className="g">
                    <th className="l" />
                    <th colSpan={segs.length} className="gap">This week</th>
                    <th colSpan={3} className="gap">Week</th>
                    <th colSpan={3} className="gap">MTD · {monthName(month)}</th>
                    <th colSpan={3} className="gap">YTD</th>
                    <th className="gap">Last week</th>
                    <th />
                  </tr>
                  <tr>
                    <th className="l" style={{ minWidth: 230 }} />
                    {segs.map((x, i) => <th key={x.month} className={i === 0 ? 'gap' : ''}>{x.label}</th>)}
                    <th className="gap">Total</th><th>Target</th><th>%</th>
                    <th className="gap">Actual</th><th>Target</th><th>%</th>
                    <th className="gap">Actual</th><th>Target</th><th>%</th>
                    <th className="gap" /><th />
                  </tr>
                </thead>
                <tbody>
                  {sections.map((sec) => (
                    <Fragment key={sec.code}>
                      <tr className="sec"><td colSpan={cols}>{sec.name}</td></tr>
                      {sec.rows.map((x, i) => {
                        if (x.group) return <tr key={`g${i}`} className="grp"><td colSpan={cols} className="l" style={{ paddingLeft: 8 }}>{x.name}</td></tr>;
                        const inp = isInput(x.code) && !x.strong;
                        const fmt = x.fmt;
                        const op = x.nature === 'opening';
                        const pc = (p) => vr(p.a, p.t, x.hib, fmt);
                        const showAdj = openAdj.has(x.code) || (s.adj[x.code] && s.adj[x.code].value) || (noteCodes.has(x.code) && segs.some((g) => parseNum(s.values[x.code]?.[g.month])));
                        const lw = d.last_week?.values?.[x.code];
                        return (
                          <Fragment key={x.code}>
                            <tr className={x.strong ? 'tot' : ''}>
                              <td className="l" style={{ paddingLeft: 8 + x.depth * 16 }}>{x.name}</td>
                              {segs.map((g, j) => (
                                <td key={g.month} className={`n ${j === 0 ? 'gap' : ''}`}>
                                  {inp && ed ? (
                                    <input className={`v ${Number.isNaN(parseNum(s.values[x.code]?.[g.month])) ? 'bad' : ''}`}
                                      ref={(el) => { refs.current[`${x.code}|${g.month}`] = el; }}
                                      value={s.values[x.code]?.[g.month] ?? ''}
                                      onChange={(e) => change((st) => { (st.values[x.code] ||= {})[g.month] = e.target.value; return st; })}
                                      onBlur={(e) => { const n = parseNum(e.target.value); if (n != null && !Number.isNaN(n)) change((st) => { st.values[x.code][g.month] = plainNum(n); return st; }); }}
                                      onKeyDown={(e) => onKey(e, x.code, g.month)} onPaste={(e) => onPaste(e, x.code, g.month)} inputMode="decimal" />
                                  ) : inp ? fv(parseNum(s.values[x.code]?.[g.month]), fmt, '1') : ''}
                                </td>
                              ))}
                              <td className="n gap">{fv(x.wk.a, fmt, '1')}</td>
                              <td className="n lock">{op ? '' : fv(x.wk.t, fmt, '1')}</td>
                              <td className={`n ${pc(x.wk).cls}`}>{op ? '' : fpct(pc(x.wk).pct)}</td>
                              <td className="n gap">{fv(x.mtd.a, fmt, '1')}</td>
                              <td className="n lock">{op ? '' : fv(x.mtd.t, fmt, '1')}</td>
                              <td className={`n ${pc(x.mtd).cls}`}>{op ? '' : fpct(pc(x.mtd).pct)}</td>
                              <td className="n gap">{fv(x.ytd.a, fmt, '1')}</td>
                              <td className="n lock">{op ? '' : fv(x.ytd.t, fmt, '1')}</td>
                              <td className={`n ${pc(x.ytd).cls}`}>{op ? '' : fpct(pc(x.ytd).pct)}</td>
                              <td className="n gap lock">{lw != null ? fv(lw, fmt, '1') : ''}</td>
                              <td>{inp && ed && <button className="link small" onClick={() => setOpenAdj((o) => { const n = new Set(o); n.has(x.code) ? n.delete(x.code) : n.add(x.code); return n; })}>adj</button>}</td>
                            </tr>
                            {inp && showAdj && (
                              <tr className="adj">
                                <td className="l small" style={{ paddingLeft: 24 + x.depth * 16 }}>{noteCodes.has(x.code) ? 'Explanation' : 'Prior-week adjustment'}</td>
                                {noteCodes.has(x.code) ? (
                                  <td colSpan={segs.length + 10}>
                                    <input className="t" disabled={!ed} value={s.notes[x.code] || ''} onChange={(e) => change((st) => { st.notes[x.code] = e.target.value; return st; })} />
                                  </td>
                                ) : (
                                  <>
                                    <td className="n gap">
                                      <input className="v" disabled={!ed} value={s.adj[x.code]?.value ?? ''} placeholder="+ / −"
                                        onChange={(e) => change((st) => { st.adj[x.code] = { ...(st.adj[x.code] || { reason: '' }), value: e.target.value }; return st; })} />
                                    </td>
                                    <td colSpan={segs.length - 1 + 10}>
                                      <input className="t" disabled={!ed} value={s.adj[x.code]?.reason || ''} placeholder="Reason"
                                        style={parseNum(s.adj[x.code]?.value) && !s.adj[x.code]?.reason ? { borderColor: 'var(--bad)' } : undefined}
                                        onChange={(e) => change((st) => { st.adj[x.code] = { ...(st.adj[x.code] || { value: '' }), reason: e.target.value }; return st; })} />
                                    </td>
                                  </>
                                )}
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="row" style={{ marginTop: 16, alignItems: 'flex-end' }}>
            <label className="f" style={{ flex: 1, minWidth: 300 }}>Remarks
              <textarea rows={2} disabled={!ed} value={s.remarks} onChange={(e) => { setS({ ...s, remarks: e.target.value }); setDirty(true); }} />
            </label>
            {ed && <>
              <button onClick={save} disabled={busy}>Save draft{dirty ? ' •' : ''}</button>
              <button className="dark" onClick={() => setAsk('file')} disabled={busy || !!fileBlock} title={fileBlock}>{d.status === 'reopened' ? 'Refile' : 'File'}</button>
            </>}
          </div>
          {ed && fileBlock && <div className="small mute" style={{ marginTop: 6, textAlign: 'right' }}>{fileBlock}</div>}
        </>
      )}

      {ask === 'file' && <Ask title={`File ${d.company.name} · ${d.week.key}?`} okText="File" onClose={() => setAsk(null)} onOk={file} />}
      {ask === 'reopen' && <Ask title="Reopen" label="Reason" okText="Reopen" onClose={() => setAsk(null)}
        onOk={async (reason) => { try { await api.post(`${url}/reopen`, { reason }); await load(); } catch (e) { notify(e.message, 'err'); } }} />}
      {hist && (
        <Modal title={`${d.company.name} · ${d.week.key}`} wide onClose={() => setHist(null)}>
          <table className="r">
            <thead><tr><th className="l" />{hist.filings.map((f) => <th key={f.revision}>rev {f.revision}<br /><span className="mute">{f.filed_at.slice(0, 16)}{f.filed_by ? ` · ${f.filed_by}` : ''}</span></th>)}</tr></thead>
            <tbody>{hist.items.filter((it) => hist.filings.some((f) => f.totals[it.key] != null)).map((it) => (
              <tr key={it.key}><td className="l">{it.label}</td>{hist.filings.map((f) => <td key={f.revision} className="n">{fv(f.totals[it.key], /:(PQ|SQ)$/.test(it.key) ? 'qty' : 'amount', '1')}</td>)}</tr>
            ))}</tbody>
          </table>
          {hist.reopens.map((r, i) => <div key={i} className="small">{r.at} · {r.name}: {r.detail.reason}</div>)}
        </Modal>
      )}
    </>
  );
}
