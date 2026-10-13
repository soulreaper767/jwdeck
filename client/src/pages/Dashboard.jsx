import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend, BarChart, Cell, LineChart,
} from 'recharts';
import { useApp } from '../store.jsx';
import { api, qs } from '../lib/api.js';
import { fmtVal, variance } from '../lib/format.js';
import ViewBar from '../components/ViewBar.jsx';
import { Spinner } from '../components/ui.jsx';

export function useReport(extra = {}) {
  const { view } = useApp();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const q = qs({ node: view.nodeId, freq: view.freq, key: view.key, mode: view.mode, lfl: view.lfl ? 1 : 0, ...extra });
  useEffect(() => {
    if (!view.nodeId) return undefined;
    let live = true;
    setErr('');
    api.get(`/consol/report${q}`).then((r) => live && setData(r)).catch((e) => live && setErr(e.message));
    return () => { live = false; };
  }, [q, view.nodeId]);
  return { data, err };
}

export function Crumbs({ path, onPick }) {
  return (
    <div className="crumbs">
      {path.map((p, i) => (
        <span key={p.id} className="row" style={{ gap: 6 }}>
          {i > 0 && <span className="faint">›</span>}
          {i === path.length - 1 ? <b>{p.name}</b> : <a href="#" onClick={(e) => { e.preventDefault(); onPick(p.id); }}>{p.name}</a>}
        </span>
      ))}
    </div>
  );
}

export function Coverage({ cov, label, lfl }) {
  if (!cov || cov.filed >= cov.expected) return null;
  return (
    <div className="alert warn">
      <span>⚠</span>
      <span>
        <b>Partial figures.</b> {cov.filed} of {cov.expected} company-period filings are in for {label}. Missing companies are excluded
        until they file{lfl ? ', and comparatives are like-for-like (same companies only)' : ''}. <Link to="/status">See filing status →</Link>
      </span>
    </div>
  );
}

const C1 = '#1f6feb';
const C2 = '#b4c6e0';

export default function Dashboard() {
  const { view, setView } = useApp();
  const { data, err } = useReport();
  const [trend, setTrend] = useState(null);
  const [selCode, setSelCode] = useState('REV');

  useEffect(() => {
    if (!view.nodeId || !data) return;
    let live = true;
    api.get(`/consol/trend${qs({ node: view.nodeId, freq: view.freq, key: data.key, n: view.freq === 'weekly' ? 13 : 12 })}`)
      .then((r) => live && setTrend(r)).catch(() => {});
    return () => { live = false; };
  }, [view.nodeId, view.freq, data?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const kpis = useMemo(() => (data ? data.heads.filter((h) => h.is_kpi) : []), [data]);
  const sel = kpis.find((k) => k.code === selCode) || kpis[0];

  if (err) return <><div className="topbar"><ViewBar /></div><div className="content"><div className="alert err">{err}</div></div></>;
  if (!data) return <><div className="topbar"><ViewBar /></div><Spinner /></>;

  const s = view.scale;
  const childRows = data.children.map((c) => ({ ...c, v: data.by_child[c.id]?.cur?.[sel?.id] ?? null, cov: data.by_child[c.id]?.coverage }));
  const childChart = childRows.filter((c) => c.v != null).sort((a, b) => b.v - a.v);
  const total = data.cur[sel?.id];

  return (
    <>
      <div className="topbar"><ViewBar /></div>
      <div className="content stack">
        <div className="page-head">
          <div>
            <Crumbs path={data.path} onPick={(id) => setView({ nodeId: id })} />
            <h1 style={{ marginTop: 4 }}>{data.node.name}</h1>
            <div className="sub">{data.labels.cur} · compared with {data.labels.prev ? `${data.labels.prev} and ` : ''}{data.labels.ly} · {data.group_currency}</div>
          </div>
          <div className="spacer" />
          <Link to="/report"><button>Full statement →</button></Link>
        </div>

        <Coverage cov={data.coverage.cur} label={data.labels.cur} lfl={data.lfl} />
        {data.fx_missing.length > 0 && <div className="alert warn">No FX rate for {data.fx_missing.join(', ')}; translated at 1.0. Add rates under Settings & FX.</div>}

        <div className="kpis">
          {kpis.map((h) => {
            const vp = variance(data.cur[h.id], data.prev?.[h.id], h.higher_is_better, h.fmt);
            const vl = variance(data.cur[h.id], data.ly[h.id], h.higher_is_better, h.fmt);
            const spark = trend?.points.map((p) => ({ v: p[h.code] })) || [];
            return (
              <div key={h.id} className={`card kpi ${sel?.id === h.id ? 'sel' : ''}`} onClick={() => setSelCode(h.code)}>
                <div className="row"><div className="t grow">{h.name}</div>
                  <div style={{ width: 70, height: 24 }}>
                    <ResponsiveContainer><LineChart data={spark}><Line dataKey="v" stroke={C1} dot={false} strokeWidth={1.5} isAnimationActive={false} /></LineChart></ResponsiveContainer>
                  </div>
                </div>
                <div className="v">{fmtVal(data.cur[h.id], h.fmt, s, { compact: true })}</div>
                <div className="cmp">
                  {data.prev && <span>vs prev <span className={`delta ${vp.cls}`}>{vp.text || '–'}</span></span>}
                  <span>vs LY <span className={`delta ${vl.cls}`}>{vl.text || '–'}</span></span>
                </div>
              </div>
            );
          })}
        </div>

        <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1.6fr) minmax(0,1fr)' }}>
          <div className="card">
            <div className="card-h"><h2>{sel?.name} trend</h2><span className="muted small">this year vs last year</span></div>
            <div className="card-b" style={{ height: 300 }}>
              {trend ? (
                <ResponsiveContainer>
                  <ComposedChart data={trend.points}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef2f6" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => fmtVal(v, sel?.fmt, s, { compact: true })} width={60} />
                    <Tooltip formatter={(v) => fmtVal(v, sel?.fmt, s)} />
                    <Legend />
                    <Bar dataKey={sel?.code} name="Current" fill={C1} radius={[3, 3, 0, 0]} />
                    <Line dataKey={`${sel?.code}_LY`} name="Last year" stroke="#f2a33a" strokeWidth={2} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              ) : <Spinner />}
            </div>
          </div>
          <div className="card">
            <div className="card-h"><h2>{sel?.name} by {data.children[0]?.type === 'company' ? 'company' : 'cluster'}</h2></div>
            <div className="card-b" style={{ height: 300 }}>
              {childChart.length ? (
                <ResponsiveContainer>
                  <BarChart data={childChart} layout="vertical" margin={{ left: 10 }}>
                    <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => fmtVal(v, sel?.fmt, s, { compact: true })} />
                    <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v) => fmtVal(v, sel?.fmt, s)} />
                    <Bar dataKey="v" name={sel?.name} radius={[0, 3, 3, 0]} cursor="pointer"
                      onClick={(d) => (d.type === 'company' ? null : setView({ nodeId: d.id }))}>
                      {childChart.map((c) => <Cell key={c.id} fill={c.v < 0 ? '#e5786f' : c.type === 'company' ? C2 : C1} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : <div className="empty">No breakdown available</div>}
            </div>
          </div>
        </div>

        {data.children.length > 0 && (
          <div className="card">
            <div className="card-h"><h2>Units under {data.node.name}</h2><span className="muted small">click a cluster to drill in</span></div>
            <div className="card-b flush" style={{ overflowX: 'auto' }}>
              <table className="t">
                <thead>
                  <tr>
                    <th>Unit</th>
                    {kpis.map((h) => <th key={h.id} className="num">{h.name}</th>)}
                    <th className="num">Share of {sel?.name}</th>
                    <th>Filed</th>
                  </tr>
                </thead>
                <tbody>
                  {data.children.map((c) => {
                    const bc = data.by_child[c.id];
                    const share = total ? (bc?.cur?.[sel?.id] ?? 0) / total * 100 : null;
                    return (
                      <tr key={c.id} className="click" onClick={() => (c.type === 'company' ? null : setView({ nodeId: c.id }))}>
                        <td className="lbl">
                          <span className={`ico ${c.type}`} style={{ display: 'inline-grid', marginRight: 8, width: 18, height: 18, borderRadius: 4, fontSize: 10, fontWeight: 700, placeItems: 'center' }}>{c.type === 'company' ? 'Co' : 'C'}</span>
                          {c.type === 'company' ? <Link to={`/company/${c.id}`} onClick={(e) => e.stopPropagation()}>{c.name}</Link> : c.name}
                        </td>
                        {kpis.map((h) => {
                          const vl = variance(bc?.cur?.[h.id], bc?.ly?.[h.id], h.higher_is_better, h.fmt);
                          return (
                            <td key={h.id} className="num">
                              {fmtVal(bc?.cur?.[h.id], h.fmt, s)}
                              <div className={`delta ${vl.cls}`} style={{ fontSize: 11 }}>{vl.text && `${vl.text} LY`}</div>
                            </td>
                          );
                        })}
                        <td className="num" style={{ width: 160 }}>
                          {share != null && <div className="row"><div className="bar grow"><i style={{ width: `${Math.max(0, Math.min(100, share))}%` }} /></div><span className="small">{share.toFixed(1)}%</span></div>}
                        </td>
                        <td><span className="small muted">{bc?.coverage.filed}/{bc?.coverage.expected}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
