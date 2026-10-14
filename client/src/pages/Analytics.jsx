import { Fragment, useState } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell, ReferenceLine, LabelList } from 'recharts';
import { useApp } from '../store.jsx';
import { fv, fpct, UNITS } from '../lib/format.js';
import { NodeSelect, WeekSelect, UnitSelect, Seg, Loading, Logo, PrintButton, PrintHeader, PeriodPicker, periodQuery } from '../ui.jsx';
import { useView, Crumbs } from './Weekly.jsx';
import { C, ChartCard } from './Overview.jsx';

const tip = { borderRadius: 4, border: '1px solid #d0d0d0', fontFamily: 'Times New Roman', fontSize: 13 };
const fmtOf = (code) => (code === 'ALL:PQ' ? 'qty' : 'amount');

function Diverging({ list, unit, code }) {
  const data = list.filter((e) => e.pct != null).map((e) => ({ name: e.name.replace(' Cluster', ''), pct: Number(e.pct.toFixed(1)), a: e.a, t: e.t }));
  if (!data.length) return <div className="empty">No budget to compare against.</div>;
  return (
    <ResponsiveContainer>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 40, left: 8, bottom: 0 }}>
        <CartesianGrid stroke={C.grid} horizontal={false} />
        <XAxis type="number" domain={[(min) => Math.min(0, Math.floor(min)), (max) => Math.max(0, Math.ceil(max))]} tickFormatter={(v) => `${Math.round(v * 10) / 10}%`} tick={{ fontSize: 12, fill: '#605E5C' }} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 12.5, fill: '#252423' }} axisLine={false} tickLine={false} />
        <Tooltip contentStyle={tip} formatter={(v, n, p) => [`${v > 0 ? '+' : ''}${v}% · actual ${fv(p.payload.a, fmtOf(code), unit)} vs budget ${fv(p.payload.t, fmtOf(code), unit)}`, 'vs budget']} />
        <ReferenceLine x={0} stroke="#252423" />
        <Bar dataKey="pct" isAnimationActive={false} barSize={16} radius={3}>
          {data.map((d, i) => <Cell key={i} fill={d.pct >= 0 ? C.pos : C.neg} />)}
          <LabelList dataKey="pct" position="right" formatter={(v) => `${v > 0 ? '+' : ''}${v}%`} style={{ fontSize: 12, fill: '#252423' }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function Podium({ title, list, unit, code, hib, good }) {
  return (
    <div className={`cc podium ${good ? 'up' : 'down'}`}>
      <div className="cc-h"><span className="cc-t">{title}</span></div>
      {list.length === 0 ? <div className="mute small">—</div> : list.map((e, i) => (
        <div key={e.id} className="pod-row">
          <span className="pod-n">{i + 1}</span>
          <span className="pod-name">{e.name}{e.cluster ? <span className="mute small"> · {e.cluster}</span> : null}</span>
          <span className="sp" />
          <span className="pod-a">{fv(e.a, fmtOf(code), unit)}</span>
          {e.pct != null && <span className={`chip ${(hib ? e.pct >= 0 : e.pct <= 0) ? 'good' : 'bad'}`}>{fpct(e.pct)}</span>}
        </div>
      ))}
    </div>
  );
}

export default function Analytics() {
  const { view, setView, periods } = useApp();
  const [basis, setBasis] = useState('mtd');
  const per = ['month', 'quarter', 'half', 'year'].includes(basis);
  const pq = periodQuery(view, periods);
  const [metric, setMetric] = useState('REV_NET');
  const [scope, setScope] = useState('companies');
  const unit = view.unit;
  const { data, err } = useView('/view/analytics', { node: view.nodeId, week: view.week, basis, ...(per ? { ...pq, mode: basis } : {}) }, [view.nodeId, view.week, basis, per && pq.month, per && pq.fy, per && pq.q, per && pq.h, per && pq.cmp]);

  if (err) return <div className="note err">{err}</div>;
  const sets = data ? (scope === 'units' && data.rankings.units.length ? data.rankings.units : data.rankings.companies.length ? data.rankings.companies : data.rankings.units) : [];
  const m = sets.find((x) => x.code === metric) || sets[0];
  const withT = m ? m.list.filter((e) => e.pct != null) : [];
  const top = withT.slice(0, 3);
  const bottom = withT.slice(-3).reverse().filter((e) => !top.includes(e));

  return (
    <>
      <div className="bar">
        <NodeSelect value={view.nodeId} onChange={(id) => setView({ nodeId: id })} />
        <Seg value={basis} options={[['wk', 'Week'], ['mtd', 'MTD'], ['ytd', 'YTD'], ['month', 'Month'], ['quarter', 'Quarter'], ['half', 'Half-year'], ['year', 'Year']]} onChange={setBasis} />
        {per ? <PeriodPicker mode={basis} /> : <WeekSelect value={view.week} onChange={(w) => setView({ week: w })} />}
        <UnitSelect />
        <span className="sp" />
        <PrintButton />
      </div>
      {!data ? <Loading /> : (
        <div className="dash">
          <PrintHeader node={data.node} period={`${data.week.label} · ${data.basis_label}`} title="Performance analytics" />
          <Crumbs path={data.path} onPick={(id) => setView({ nodeId: id })} />
          <div className="title"><Logo node={data.node} /><h1>{data.node.name}</h1><span className="meta">Performance · {data.period ? data.period.label : `${data.week.label} · ${data.basis_label}`} · {UNITS[unit].label}</span></div>

          {data.highlights.length > 0 && (
            <div className="hl-grid">
              <div className="cc hl up">
                <div className="cc-h"><span className="cc-t">Went well</span></div>
                {data.highlights.filter((h) => h.good).map((h, i) => <div key={i} className="hl-row">▲ {h.text}</div>)}
              </div>
              <div className="cc hl down">
                <div className="cc-h"><span className="cc-t">Needs attention</span></div>
                {data.highlights.filter((h) => !h.good).map((h, i) => <div key={i} className="hl-row">▼ {h.text}</div>)}
              </div>
            </div>
          )}

          {sets.length > 0 && (
            <>
              <div className="row" style={{ marginTop: 22 }}>
                <h2 className="part" style={{ margin: 0 }}>Ranking vs budget</h2>
                <span className="sp" />
                {data.rankings.units.length > 0 && data.rankings.companies.length > 0 && (
                  <Seg value={scope} options={[['units', `By ${data.node.type === 'group' ? 'cluster' : 'unit'}`], ['companies', 'By company']]} onChange={setScope} />
                )}
              </div>
              <div className="chips-row">
                {sets.map((x) => <button key={x.code} className={`pill ${x.code === m?.code ? 'on' : ''}`} onClick={() => setMetric(x.code)}>{x.name}</button>)}
              </div>
              <div className="cgrid" style={{ marginTop: 10 }}>
                <ChartCard title={`${m.name} · ${data.basis_label}`} sub="% above or below budget" h={Math.max(160, withT.length * 34 + 30)}>
                  <Diverging list={m.list} unit={unit} code={m.code} />
                </ChartCard>
                <div className="pod-col">
                  <Podium title="Top performers" list={top} unit={unit} code={m.code} hib={m.hib} good />
                  <Podium title="Bottom performers" list={bottom} unit={unit} code={m.code} hib={m.hib} />
                </div>
              </div>
            </>
          )}

          {data.rankings.month.length > 0 && (
            <>
              <h2 className="part">{data.month_label} profit ranking</h2>
              <div className="cc">
                <div className="wrap">
                  <table className="r pbi">
                    <thead>
                      <tr className="g"><th className="l first">Company</th>{data.rankings.month.map((x) => <th key={x.code} colSpan={3} className="gap">{x.name}</th>)}</tr>
                      <tr><th className="l first" />{data.rankings.month.map((x) => <Fragment key={x.code}><th className="gap">Actual</th><th>Budget</th><th>vs budget</th></Fragment>)}</tr>
                    </thead>
                    <tbody>
                      {data.rankings.month.find((x) => x.code === 'PL_EBITDA').list.map((e) => (
                        <tr key={e.id}>
                          <td className="l first">{e.name}</td>
                          {data.rankings.month.map((x) => {
                            const r = x.list.find((y) => y.id === e.id);
                            return (
                              <Fragment key={x.code}>
                                <td className="n gap">{fv(r?.a, 'amount', unit)}</td>
                                <td className="n lock">{fv(r?.t, 'amount', unit)}</td>
                                <td className="n">{r?.pct != null && <span className={`chip ${r.pct >= 0 ? 'good' : 'bad'}`}>{fpct(r.pct)}</span>}</td>
                              </Fragment>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          <div className="cgrid" style={{ marginTop: 22 }}>
            {data.skus.length > 0 && (
              <div className="cc">
                <div className="cc-h"><span className="cc-t">SKUs · sales value vs budget</span><span className="cc-s">{data.basis_label}</span></div>
                <table className="r pbi">
                  <thead><tr><th className="l">SKU</th><th className="l">Company</th><th>Actual</th><th>Budget</th><th>vs budget</th></tr></thead>
                  <tbody>
                    {[...data.skus.slice(0, 5), ...(data.skus.length > 10 ? [{ gap: true }] : []), ...data.skus.slice(Math.max(5, data.skus.length - 5))].map((s, i) => (s.gap
                      ? <tr key="gap"><td colSpan={5} className="mute small" style={{ textAlign: 'center' }}>· · ·</td></tr>
                      : (
                        <tr key={i}>
                          <td className="l">{s.sku}</td><td className="l mute">{s.company}</td>
                          <td className="n">{fv(s.a, 'amount', unit)}</td><td className="n lock">{fv(s.t, 'amount', unit)}</td>
                          <td className="n">{s.pct != null && <span className={`chip ${s.pct >= 0 ? 'good' : 'bad'}`}>{fpct(s.pct)}</span>}</td>
                        </tr>
                      )))}
                  </tbody>
                </table>
              </div>
            )}
            {data.movers.length > 0 && (
              <div className="cc">
                <div className="cc-h"><span className="cc-t">Biggest movers</span><span className="cc-s">{data.period ? `${data.period.label} vs ${data.period.compare}` : "this week vs last week"}</span></div>
                <table className="r pbi">
                  <thead><tr><th className="l">Company</th><th className="l">Line</th><th>{data.period ? data.period.compare.split(" · ")[0] : "Last week"}</th><th>{data.period ? data.period.label.split(" · ")[0] : "This week"}</th><th>Change</th></tr></thead>
                  <tbody>{data.movers.map((x, i) => (
                    <tr key={i}>
                      <td className="l">{x.company}</td><td className="l mute">{x.metric}</td>
                      <td className="n lock">{fv(x.before, fmtOf(x.code), unit)}</td><td className="n">{fv(x.now, fmtOf(x.code), unit)}</td>
                      <td className="n"><span className={`chip ${x.good ? 'good' : 'bad'}`}>{x.pct > 0 ? '▲' : '▼'} {fpct(x.pct)}</span></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
            {data.streaks.length > 0 && (
              <div className="cc">
                <div className="cc-h"><span className="cc-t">Net revenue vs budget · last 13 weeks</span></div>
                <div className="legend-line"><span><i style={{ background: C.pos }} />On / above budget</span><span><i style={{ background: C.neg }} />Below budget</span><span><i style={{ background: '#d9d9d9' }} />No figures</span></div>
                {data.streaks.map((s) => (
                  <div key={s.company_id} className="streak">
                    <span className="streak-n">{s.company}</span>
                    <span className="streak-b">{s.history.map((v, i) => <i key={i} style={{ background: v == null ? '#d9d9d9' : v ? C.pos : C.neg }} />)}</span>
                    <span className="streak-t">{s.on ? `${s.on} wk on` : s.off ? `${s.off} wk below` : ''}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
