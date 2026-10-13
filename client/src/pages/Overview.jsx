import { useEffect, useState } from 'react';
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { useApp } from '../store.jsx';
import { api, qs } from '../lib/api.js';
import { fv, vr, fpct, UNITS } from '../lib/format.js';
import { NodeSelect, WeekSelect, UnitSelect, Loading, Num, St, Logo } from '../ui.jsx';
import { useView, Crumbs, StatusCounts } from './Weekly.jsx';

const WK = ['REV_NET', 'REC_TOT', 'PAY_TOT', 'CB_CLOSE'];
const MO = ['PL_REV', 'PL_GP', 'PL_EBITDA', 'PL_NP'];
const flat = (d) => (d ? Object.fromEntries(d.sections.flatMap((s) => s.rows).filter((x) => x.code).map((x) => [x.code, x])) : {});

function Fig({ x, a, t, unit, sub }) {
  if (!x) return null;
  const v = vr(a, t, x.hib, x.fmt);
  return (
    <div className="fig">
      <div className="k">{x.name}</div>
      <div className="v" title={fv(a, 'amount', '1')}>{fv(a, x.fmt, unit) || '–'}</div>
      <div className="s"><span className={v.cls}>{fpct(v.pct)} vs target</span>{sub}</div>
    </div>
  );
}

export default function Overview() {
  const { view, setView, periods } = useApp();
  const unit = view.unit;
  const { data, err } = useView('/view/week', { node: view.nodeId, week: view.week }, [view.nodeId, view.week]);
  const lm = periods?.last_month;
  const { data: mon } = useView('/view/month', { node: view.nodeId, month: lm }, [view.nodeId, lm]);
  const [trend, setTrend] = useState(null);
  useEffect(() => {
    if (!view.nodeId || !view.week) return undefined;
    let live = true;
    api.get(`/view/trend${qs({ node: view.nodeId, week: view.week, n: 13, codes: 'REV_NET,REC_TOT,PAY_TOT,CB_CLOSE' })}`).then((r) => live && setTrend(r.points)).catch(() => {});
    return () => { live = false; };
  }, [view.nodeId, view.week]);

  const w = flat(data);
  const m = flat(mon);
  const ax = (v) => fv(v, 'amount', 'm');
  const tip = { borderRadius: 0, border: '1px solid #000', fontFamily: 'Times New Roman' };

  return (
    <>
      <div className="bar">
        <NodeSelect value={view.nodeId} onChange={(id) => setView({ nodeId: id })} />
        <WeekSelect value={view.week} onChange={(wk) => setView({ week: wk, month: null })} />
        <UnitSelect />
      </div>
      {err && <div className="note err">{err}</div>}
      {!data ? <Loading /> : (
        <>
          <Crumbs path={data.path} onPick={(id) => setView({ nodeId: id })} />
          <div className="title">
            <Logo node={data.node} />
            <h1>{data.node.name}</h1>
            <span className="meta">{UNITS[unit].label}</span>
            <span className="sp" />
            {data.node.type === 'company' ? <St s={data.coverage.status[0]?.status} reopened={data.coverage.status[0]?.reopened} /> : <StatusCounts by={data.coverage.by} />}
          </div>

          <h2 className="part">{data.week.label}</h2>
          <div className="figs">
            {WK.map((k) => <Fig key={k} x={w[k]} a={w[k]?.wk.a} t={w[k]?.wk.t} unit={unit}
              sub={<span>MTD {fv(w[k]?.mtd.a, 'amount', unit)} <span className={vr(w[k]?.mtd.a, w[k]?.mtd.t, w[k]?.hib).cls}>{fpct(vr(w[k]?.mtd.a, w[k]?.mtd.t, w[k]?.hib).pct)}</span></span>} />)}
          </div>

          {mon && (
            <>
              <h2 className="part">{mon.month_label} <span className="small mute">{mon.complete ? '' : 'in progress'}</span></h2>
              <div className="figs">
                {MO.map((k) => <Fig key={k} x={m[k]} a={m[k]?.m.a} t={m[k]?.m.b} unit={unit}
                  sub={<span>YTD {fv(m[k]?.y.a, 'amount', unit)}</span>} />)}
              </div>
            </>
          )}

          {trend && (
            <div className="grid2">
              <div>
                <h3 style={{ fontWeight: 'bold' }}>Net revenue by week <span className="small mute">actual · target</span></h3>
                <div className="chart">
                  <ResponsiveContainer>
                    <ComposedChart data={trend} margin={{ top: 10, right: 6, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke="#e9e9e9" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#000' }} axisLine={{ stroke: '#000' }} tickLine={false} />
                      <YAxis tick={{ fontSize: 12, fill: '#000' }} tickFormatter={ax} width={52} axisLine={false} tickLine={false} />
                      <Tooltip formatter={(v) => fv(v, 'amount', unit)} contentStyle={tip} />
                      <Bar dataKey="REV_NET" name="Actual" fill="#262626" barSize={16} />
                      <Line dataKey="REV_NET_T" name="Target" stroke="#9c1c14" strokeDasharray="4 3" dot={false} strokeWidth={1.5} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div>
                <h3 style={{ fontWeight: 'bold' }}>Cash & bank <span className="small mute">closing · recoveries · payments</span></h3>
                <div className="chart">
                  <ResponsiveContainer>
                    <ComposedChart data={trend} margin={{ top: 10, right: 6, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke="#e9e9e9" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#000' }} axisLine={{ stroke: '#000' }} tickLine={false} />
                      <YAxis tick={{ fontSize: 12, fill: '#000' }} tickFormatter={ax} width={52} axisLine={false} tickLine={false} />
                      <Tooltip formatter={(v) => fv(v, 'amount', unit)} contentStyle={tip} />
                      <Bar dataKey="REC_TOT" name="Recoveries" fill="#8c8c8c" barSize={7} />
                      <Bar dataKey="PAY_TOT" name="Payments" fill="#d4d4d4" barSize={7} />
                      <Line dataKey="CB_CLOSE" name="Closing" stroke="#000" strokeWidth={2} dot={{ r: 2 }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )}

          {data.children?.length > 0 && (
            <>
              <h2 className="part">By {data.children[0].type === 'company' ? 'company' : 'cluster'}</h2>
              <div className="wrap">
                <table className="r">
                  <thead>
                    <tr className="g"><th className="l first" /><th colSpan={3} className="gap">Net revenue · week</th><th colSpan={2} className="gap">Net revenue · MTD</th>
                      <th colSpan={2} className="gap">Recoveries · MTD</th><th className="gap">Cash</th><th colSpan={2} className="gap">{mon?.month_label}</th><th className="gap" /></tr>
                    <tr><th className="l first" /><th className="gap">Target</th><th>Actual</th><th>%</th><th className="gap">Actual</th><th>%</th>
                      <th className="gap">Actual</th><th>%</th><th className="gap">Closing</th><th className="gap">EBITDA</th><th>Net profit</th><th className="gap l">Status</th></tr>
                  </thead>
                  <tbody>
                    {data.children.map((c) => {
                      const r = c.rows;
                      const mc = mon?.children?.find((x) => x.id === c.id)?.rows || {};
                      const p = (x, k) => vr(x?.[k]?.a, x?.[k]?.t, 1);
                      return (
                        <tr key={c.id} className="click" onClick={() => setView({ nodeId: c.id })}>
                          <td className="l first"><span className="row" style={{ flexWrap: 'nowrap' }}><Logo node={c} size="sm" />{c.name}</span></td>
                          <Num className="gap lock" v={r.REV_NET?.wk.t} unit={unit} /><Num v={r.REV_NET?.wk.a} unit={unit} />
                          <td className={`n ${p(r.REV_NET, 'wk').cls}`}>{fpct(p(r.REV_NET, 'wk').pct)}</td>
                          <Num className="gap" v={r.REV_NET?.mtd.a} unit={unit} />
                          <td className={`n ${p(r.REV_NET, 'mtd').cls}`}>{fpct(p(r.REV_NET, 'mtd').pct)}</td>
                          <Num className="gap" v={r.REC_TOT?.mtd.a} unit={unit} />
                          <td className={`n ${p(r.REC_TOT, 'mtd').cls}`}>{fpct(p(r.REC_TOT, 'mtd').pct)}</td>
                          <Num className="gap" v={r.CB_CLOSE?.wk.a} unit={unit} />
                          <Num className="gap" v={mc.PL_EBITDA?.m.a} unit={unit} />
                          <Num v={mc.PL_NP?.m.a} unit={unit} />
                          <td className="l gap">{c.type === 'company' ? <St s={c.status} reopened={c.reopened} /> : <StatusCounts by={c.coverage.by} />}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}
