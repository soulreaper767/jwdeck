import { useEffect, useState } from 'react';
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { useApp } from '../store.jsx';
import { api, qs } from '../lib/api.js';
import { fv, vr, fpct, UNITS } from '../lib/format.js';
import { NodeSelect, WeekSelect, UnitSelect, Loading, Num } from '../ui.jsx';
import { useWeek } from './Weekly.jsx';

const KPIS = ['REV_NET', 'REC_TOT', 'PAY_TOT', 'CB_CLOSE', 'EBITDA', 'NP'];

export default function Overview() {
  const { view, setView } = useApp();
  const { data, err } = useWeek(view.nodeId, view.week, null);
  const [trend, setTrend] = useState(null);
  const unit = view.unit;

  useEffect(() => {
    if (!view.nodeId || !view.week) return undefined;
    let live = true;
    api.get(`/view/trend${qs({ node: view.nodeId, week: view.week, n: 13, codes: 'REV_NET,REC_TOT,PAY_TOT,CB_CLOSE' })}`).then((r) => live && setTrend(r.points)).catch(() => {});
    return () => { live = false; };
  }, [view.nodeId, view.week]);

  const rows = data ? Object.fromEntries(data.sections.flatMap((s) => s.rows).filter((x) => x.code).map((x) => [x.code, x])) : {};
  const ax = (v) => fv(v, 'amount', 'm');

  return (
    <>
      <div className="bar">
        <NodeSelect value={view.nodeId} onChange={(id) => setView({ nodeId: id })} />
        <WeekSelect value={view.week} onChange={(w) => setView({ week: w, month: null })} />
        <UnitSelect />
      </div>
      {err && <div className="note err">{err}</div>}
      {!data ? <Loading /> : (
        <>
          <div className="title">
            <h1>{data.node.name}</h1>
            <span className="meta">{data.week.label} · {UNITS[unit].label}</span>
            <span className="sp" />
            <span className={data.coverage.filed < data.coverage.started ? 'bad' : 'mute'}>Filed {data.coverage.filed}/{data.coverage.started}</span>
          </div>
          <div className="figs" style={{ marginTop: 12 }}>
            {KPIS.map((k) => rows[k] && (
              <div className="fig" key={k}>
                <div className="k">{rows[k].name}</div>
                <div className="v" title={fv(rows[k].wk.a, 'amount', '1')}>{fv(rows[k].wk.a, 'amount', unit) || '–'}</div>
                <div className="s">
                  <span>wk <span className={vr(rows[k].wk.a, rows[k].wk.t, rows[k].hib).cls}>{fpct(vr(rows[k].wk.a, rows[k].wk.t, rows[k].hib).pct)}</span></span>
                  <span>MTD {fv(rows[k].mtd.a, 'amount', unit)} <span className={vr(rows[k].mtd.a, rows[k].mtd.t, rows[k].hib).cls}>{fpct(vr(rows[k].mtd.a, rows[k].mtd.t, rows[k].hib).pct)}</span></span>
                </div>
              </div>
            ))}
          </div>

          {trend && (
            <div className="grid2">
              <div>
                <h2>Net revenue, weekly <span className="mute small">actual / target</span></h2>
                <div className="chart">
                  <ResponsiveContainer>
                    <ComposedChart data={trend} margin={{ top: 10, right: 6, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke="#ebe8e0" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#4a4a46' }} axisLine={{ stroke: '#1b1b1b' }} tickLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: '#4a4a46' }} tickFormatter={ax} width={50} axisLine={false} tickLine={false} />
                      <Tooltip formatter={(v) => fv(v, 'amount', unit)} contentStyle={{ borderRadius: 0, border: '1px solid #1b1b1b' }} />
                      <Bar dataKey="REV_NET" name="Actual" fill="#3a3a36" barSize={18} />
                      <Line dataKey="REV_NET_T" name="Target" stroke="#a3271f" strokeDasharray="4 3" dot={false} strokeWidth={1.5} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div>
                <h2>Cash & bank, closing <span className="mute small">recoveries / payments</span></h2>
                <div className="chart">
                  <ResponsiveContainer>
                    <ComposedChart data={trend} margin={{ top: 10, right: 6, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke="#ebe8e0" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#4a4a46' }} axisLine={{ stroke: '#1b1b1b' }} tickLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: '#4a4a46' }} tickFormatter={ax} width={50} axisLine={false} tickLine={false} />
                      <Tooltip formatter={(v) => fv(v, 'amount', unit)} contentStyle={{ borderRadius: 0, border: '1px solid #1b1b1b' }} />
                      <Bar dataKey="REC_TOT" name="Recoveries" fill="#9c9a92" barSize={8} />
                      <Bar dataKey="PAY_TOT" name="Payments" fill="#d8d4ca" barSize={8} />
                      <Line dataKey="CB_CLOSE" name="Closing cash & bank" stroke="#1b1b1b" strokeWidth={2} dot={{ r: 2 }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )}

          {data.children?.length > 0 && (
            <div style={{ marginTop: 26 }}>
              <h2 style={{ marginBottom: 6 }}>By {data.children[0].type === 'company' ? 'company' : 'cluster'}</h2>
              <div className="wrap">
                <table className="r">
                  <thead>
                    <tr className="g"><th className="l" /><th colSpan={3} className="gap">Net revenue · week</th><th colSpan={3} className="gap">Net revenue · MTD</th>
                      <th colSpan={2} className="gap">Recoveries · MTD</th><th className="gap">Cash & bank</th><th className="gap">EBITDA MTD</th><th className="gap" /></tr>
                    <tr><th className="l" /><th className="gap">Target</th><th>Actual</th><th>%</th><th className="gap">Target</th><th>Actual</th><th>%</th>
                      <th className="gap">Actual</th><th>%</th><th className="gap">Closing</th><th className="gap">Actual</th><th className="gap">Filed</th></tr>
                  </thead>
                  <tbody>
                    {data.children.map((c) => {
                      const r = c.rows;
                      const p = (x, k) => vr(x?.[k]?.a, x?.[k]?.t, 1);
                      return (
                        <tr key={c.id} className="click" onClick={() => setView({ nodeId: c.id })}>
                          <td className="l">{c.name}</td>
                          <Num className="gap lock" v={r.REV_NET?.wk.t} unit={unit} /><Num v={r.REV_NET?.wk.a} unit={unit} />
                          <td className={`n ${p(r.REV_NET, 'wk').cls}`}>{fpct(p(r.REV_NET, 'wk').pct)}</td>
                          <Num className="gap lock" v={r.REV_NET?.mtd.t} unit={unit} /><Num v={r.REV_NET?.mtd.a} unit={unit} />
                          <td className={`n ${p(r.REV_NET, 'mtd').cls}`}>{fpct(p(r.REV_NET, 'mtd').pct)}</td>
                          <Num className="gap" v={r.REC_TOT?.mtd.a} unit={unit} />
                          <td className={`n ${p(r.REC_TOT, 'mtd').cls}`}>{fpct(p(r.REC_TOT, 'mtd').pct)}</td>
                          <Num className="gap" v={r.CB_CLOSE?.wk.a} unit={unit} />
                          <Num className="gap" v={r.EBITDA?.mtd.a} unit={unit} />
                          <td className={`n gap ${c.coverage.filed < c.coverage.started ? 'bad' : 'mute'}`}>{c.coverage.filed}/{c.coverage.started}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}

