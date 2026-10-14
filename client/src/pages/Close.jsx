import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useApp } from '../store.jsx';
import { api } from '../lib/api.js';
import { fv, vr, fpct, parseNum, plainNum } from '../lib/format.js';
import { NodeSelect, MonthSelect, Loading, Ask, Logo, Workflow, St } from '../ui.jsx';

export default function Close() {
  const params = useParams();
  const nav = useNavigate();
  const { nodes, view, periods, canPrepare, notify, loadInbox } = useApp();
  let cid = Number(params.cid) || null;
  if (!cid) cid = [...nodes.values()].find((n) => n.type === 'company' && canPrepare(n.id))?.id || [...nodes.values()].find((n) => n.type === 'company')?.id || null;
  const month = params.month || (view.month && /^\d{4}-\d{2}$/.test(view.month) ? view.month : periods?.last_month);

  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [vals, setVals] = useState({});
  const [remarks, setRemarks] = useState('');
  const [pv, setPv] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState(false);
  const timer = useRef(null);
  const url = cid && month ? `/month/${cid}/${month}` : null;

  const load = useCallback(async () => {
    if (!url) return;
    setErr('');
    try {
      const r = await api.get(url);
      setD(r);
      setVals(Object.fromEntries(Object.entries(r.data.values).map(([k, v]) => [k, plainNum(v)])));
      setRemarks(r.data.remarks || '');
      setPv(r.preview);
      setDirty(false);
    } catch (e) { setErr(e.message); setD(null); }
  }, [url]);
  useEffect(() => { load(); }, [load]);

  const body = (v = vals) => ({ values: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, parseNum(x)]).filter(([, x]) => x != null && !Number.isNaN(x))), remarks });
  const set = (k, x) => {
    const next = { ...vals, [k]: x };
    setVals(next);
    setDirty(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => api.post(`${url}/preview`, body(next)).then(setPv).catch(() => {}), 350);
  };
  const go = (c, m) => { if (dirty && !window.confirm('Discard unsaved figures?')) return; nav(`/close/${c}/${m}`); };
  const save = async () => { setBusy(true); try { await api.put(url, body()); notify('Saved'); setDirty(false); } catch (e) { notify(e.message, 'err'); } finally { setBusy(false); } };
  const submit = async () => {
    setBusy(true);
    try { await api.post(`${url}/submit`, body()); notify('Submitted'); loadInbox(); await load(); } catch (e) { notify(e.message, 'err'); throw e; } finally { setBusy(false); }
  };

  const top = (
    <div className="bar">
      <NodeSelect value={cid} companiesOnly onChange={(c) => go(c, month)} />
      <MonthSelect value={month} onChange={(m) => go(cid, m)} />
    </div>
  );
  if (!cid) return <>{top}<div className="empty">No company in your scope.</div></>;
  if (err) return <>{top}<div className="note err">{err}</div></>;
  if (!d) return <>{top}<Loading /></>;

  const inputs = new Set(d.inputs);
  const ed = d.editable;
  const cols = 9;
  return (
    <>
      {top}
      <div className="title"><Logo node={d.company} /><h1>{d.company.name}</h1><span className="meta">Month close · {d.month_label} · due {d.due}</span></div>
      <Workflow base={url} status={d.status} reopened={d.reopened} actions={d.actions} log={d.log} onDone={load} />
      {d.needs_setup ? <div className="empty">Reporting not started.</div> : (
        <>
          <div className="row small" style={{ marginBottom: 12 }}>
            {d.weeks.map((w) => <Link key={w.key} to={`/enter/${cid}/${w.key}`} style={{ textDecoration: 'none' }}>{w.key.slice(5)} <span className="mute">{w.portion}</span> <St s={w.status} reopened={w.reopened} /></Link>)}
          </div>
          {!d.ready && <div className="note warn">Waiting for all weeks of the month.</div>}
          {pv && (
            <div className="wrap entry">
              <table className="r">
                <thead>
                  <tr className="g"><th className="l first" /><th colSpan={4} className="gap">{d.month_label}</th><th colSpan={4} className="gap">YTD · {pv.fy_label}</th></tr>
                  <tr><th className="l first" style={{ minWidth: 220 }} /><th className="gap">Budget</th><th>Actual</th><th>Var</th><th>%</th><th className="gap">Budget</th><th>Actual</th><th>Var</th><th>%</th></tr>
                </thead>
                <tbody>
                  {pv.sections.map((sec) => (
                    <Fragment key={sec.code}>
                      <tr className="sec"><td colSpan={cols} className="first">{sec.name}{sec.scope === 'week' ? <span className="small mute"> · from weeks</span> : ''}</td></tr>
                      {sec.rows.map((x, i) => {
                        if (x.group) return <tr key={`g${i}`} className="grp"><td colSpan={cols} className="l first">{x.name}</td></tr>;
                        const op = x.nature === 'opening';
                        const m = vr(x.m.a, x.m.b, x.hib, x.fmt);
                        const y = vr(x.y.a, x.y.b, x.hib, x.fmt);
                        return (
                          <tr key={x.code} className={x.grand ? 'grand' : x.strong ? 'tot' : ''}>
                            <td className="l first" style={{ paddingLeft: 8 + x.depth * 16 }}>{x.name}</td>
                            <td className="n gap lock">{op ? '' : fv(x.m.b, x.fmt, '1')}</td>
                            <td className="n">{inputs.has(x.code) && ed
                              ? <input className="v" value={vals[x.code] ?? ''} onChange={(e) => set(x.code, e.target.value)} onBlur={(e) => { const n = parseNum(e.target.value); if (n != null && !Number.isNaN(n)) setVals((v) => ({ ...v, [x.code]: plainNum(n) })); }} inputMode="decimal" />
                              : fv(x.m.a, x.fmt === 'flag' ? 'count' : x.fmt, '1')}</td>
                            <td className={`n ${m.cls}`}>{op ? '' : fv(m.d, x.fmt, '1')}</td>
                            <td className={`n ${m.cls}`}>{op ? '' : fpct(m.pct)}</td>
                            <td className="n gap lock">{op ? '' : fv(x.y.b, x.fmt, '1')}</td>
                            <td className="n">{fv(x.y.a, x.fmt, '1')}</td>
                            <td className={`n ${y.cls}`}>{op ? '' : fv(y.d, x.fmt, '1')}</td>
                            <td className={`n ${y.cls}`}>{op ? '' : fpct(y.pct)}</td>
                          </tr>
                        );
                      })}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="row" style={{ marginTop: 16, alignItems: 'flex-end' }}>
            {ed ? (
              <label className="f" style={{ flex: 1, minWidth: 260 }}>Commentary
                <textarea rows={3} value={remarks} onChange={(e) => { setRemarks(e.target.value); setDirty(true); }} />
              </label>
            ) : remarks ? <div className="cc small" style={{ flex: 1 }}><b>Commentary:</b> {remarks}</div> : null}
            {ed && <>
              <button onClick={save} disabled={busy}>Save draft{dirty ? ' •' : ''}</button>
              <button className="dark" onClick={() => setAsk(true)} disabled={busy || !d.ready}>Submit</button>
            </>}
          </div>
        </>
      )}
      {ask && <Ask title={`Submit ${d.company.name} · ${d.month_label}`} okText="Submit" onClose={() => setAsk(false)} onOk={submit} />}
    </>
  );
}
