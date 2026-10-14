import { useEffect, useState } from 'react';
import {
  ResponsiveContainer, ComposedChart, BarChart, Bar, Line, Area, AreaChart, XAxis, YAxis, Tooltip, CartesianGrid, Legend, PieChart, Pie, Cell, ReferenceLine,
} from 'recharts';
import { useApp } from '../store.jsx';
import { api, qs } from '../lib/api.js';
import { fv, vr, fpct, UNITS } from '../lib/format.js';
import { NodeSelect, WeekSelect, UnitSelect, Loading, St, Logo } from '../ui.jsx';
import { useView, Crumbs, StatusCounts } from './Weekly.jsx';

// Power BI–style palette
export const C = {
  act: '#12239E', bud: '#E66C37', budBar: '#C9CBD3', pos: '#1AAB40', neg: '#D64554', grid: '#EDEDED', ink: '#252423',
  series: ['#118DFF', '#12239E', '#E66C37', '#6B007B', '#E044A7', '#744EC2', '#D9B300', '#197278', '#D64550', '#1AAB40'],
};
const tip = { borderRadius: 4, border: '1px solid #d0d0d0', fontFamily: 'Times New Roman', fontSize: 13, boxShadow: '0 2px 8px rgba(0,0,0,.12)' };
const flat = (d) => (d ? Object.fromEntries(d.sections.flatMap((s) => s.rows).filter((x) => x.code).map((x) => [x.code, x])) : {});

function Spark({ data, k }) {
  if (!data?.length) return null;
  return (
    <div className="kc-spark">
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
          <defs><linearGradient id={`g${k}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C.act} stopOpacity={0.25} /><stop offset="100%" stopColor={C.act} stopOpacity={0} /></linearGradient></defs>
          <Area isAnimationActive={false} dataKey={k} stroke={C.act} strokeWidth={1.5} fill={`url(#g${k})`} isAnimationActive={false} dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// KPI card: actual, clearly labelled budget, variance chip, attainment bar, sparkline
export function KpiCard({ title, actual, budget, fmt = 'amount', unit, hib = 1, spark, sparkKey, foot }) {
  const v = vr(actual, budget, hib, fmt);
  const pct = budget ? Math.max(0, Math.min(150, (actual / budget) * 100)) : null;
  return (
    <div className="kc">
      <div className="kc-t">{title}</div>
      <div className="kc-v" title={actual == null ? '' : fv(actual, fmt === 'amount' ? 'amount' : fmt, '1')}>{actual == null ? '–' : fv(actual, fmt, unit)}</div>
      {budget != null && (
        <>
          <div className="kc-row">
            <span className="tag-b">Budget</span><span>{fv(budget, fmt, unit)}</span>
            <span className="sp" />
            {v.pct != null && <span className={`chip ${v.cls}`}>{v.pct > 0 ? '▲' : v.pct < 0 ? '▼' : ''} {fpct(v.pct)}</span>}
          </div>
          {pct != null && (
            <div className="kc-bar" title={`${(actual / budget * 100).toFixed(1)}% of budget`}>
              <i style={{ width: `${Math.min(100, pct / 1.5)}%`, background: v.cls === 'bad' ? C.neg : C.act }} />
              <b style={{ left: `${100 / 1.5}%` }} />
            </div>
          )}
        </>
      )}
      {foot && <div className="kc-foot">{foot}</div>}
      {spark && <Spark data={spark} k={sparkKey} />}
    </div>
  );
}

export function ChartCard({ title, sub, children, h = 260 }) {
  return (
    <div className="cc">
      <div className="cc-h"><span className="cc-t">{title}</span>{sub && <span className="cc-s">{sub}</span>}</div>
      <div style={{ height: h }}>{children}</div>
    </div>
  );
}

const axis = { tick: { fontSize: 12, fill: '#605E5C' }, axisLine: false, tickLine: false };

export default function Overview() {
  const { view, setView, periods } = useApp();
  const unit = view.unit;
  const { data, err } = useView('/view/week', { node: view.nodeId, week: view.week }, [view.nodeId, view.week]);
  const lm = periods?.last_month;
  const { data: mon } = useView('/view/month', { node: view.nodeId, month: lm }, [view.nodeId, lm]);
  const [trend, setTrend] = useState(null);
  const [mtrend, setMtrend] = useState(null);
  useEffect(() => {
    if (!view.nodeId || !view.week) return undefined;
    let live = true;
    api.get(`/view/trend${qs({ node: view.nodeId, week: view.week, n: 13, codes: 'REV_NET,REC_TOT,PAY_TOT,CB_CLOSE,BD_CONF,BD_PIPE,ALL:PQ' })}`).then((r) => live && setTrend(r.points)).catch(() => {});
    api.get(`/view/month-trend${qs({ node: view.nodeId, n: 6 })}`).then((r) => live && setMtrend(r.points)).catch(() => {});
    return () => { live = false; };
  }, [view.nodeId, view.week]);

  if (err) return <div className="note err">{err}</div>;
  const w = flat(data);
  const m = flat(mon);
  const ax = (v) => fv(v, 'amount', 'm');
  const tf = (v) => fv(v, 'amount', unit);
  const isCo = data?.node.type === 'company';

  // mix: SKU sales at company level; units' net revenue above it
  const mix = !data ? [] : isCo
    ? data.sections.find((s) => s.code === 'PRODSALES')?.rows.filter((x) => x.code?.endsWith(':SV')).map((x, i, arr) => {
      const g = data.sections.find((s) => s.code === 'PRODSALES').rows;
      const name = g[g.indexOf(x) - 3]?.name || x.name;
      return { name, value: x.mtd.a || 0 };
    }).filter((x) => x.value > 0)
    : (data.children || []).map((c) => ({ name: c.name, value: c.rows.REV_NET?.mtd.a || 0 })).filter((x) => x.value > 0);
  const units = (data?.children || []).map((c) => ({
    name: c.name.replace(' Cluster', ''), actual: c.rows.REV_NET?.mtd.a ?? null, budget: c.rows.REV_NET?.mtd.t ?? null,
    rec: c.rows.REC_TOT?.mtd.a ?? null, cash: c.rows.CB_CLOSE?.wk.a ?? null,
  }));
  const prod = !data ? [] : data.sections.find((s) => s.code === 'PRODSALES').rows
    .filter((x) => /^UNIT:PQ:/.test(x.code)).map((x) => ({ name: x.name.replace(/^Total production \(|\)$/g, ''), actual: x.mtd.a, budget: x.mtd.t }));

  return (
    <>
      <div className="bar">
        <NodeSelect value={view.nodeId} onChange={(id) => setView({ nodeId: id })} />
        <WeekSelect value={view.week} onChange={(wk) => setView({ week: wk, month: null })} />
        <UnitSelect />
      </div>
      {!data ? <Loading /> : (
        <div className="dash">
          <Crumbs path={data.path} onPick={(id) => setView({ nodeId: id })} />
          <div className="title">
            <Logo node={data.node} />
            <h1>{data.node.name}</h1>
            <span className="meta">{data.week.label} · {UNITS[unit].label}</span>
            <span className="sp" />
            {isCo ? <St s={data.coverage.status[0]?.status} reopened={data.coverage.status[0]?.reopened} /> : <StatusCounts by={data.coverage.by} />}
          </div>
          <div className="legend-line"><span><i style={{ background: C.act }} />Actual</span><span><i style={{ background: C.bud }} />Budget / target</span><span><i style={{ background: C.pos }} />Better than budget</span><span><i style={{ background: C.neg }} />Worse than budget</span></div>

          <h2 className="part">This week</h2>
          <div className="kgrid">
            <KpiCard title="Net revenue · week" actual={w.REV_NET?.wk.a} budget={w.REV_NET?.wk.t} unit={unit} spark={trend} sparkKey="REV_NET" />
            <KpiCard title="Net revenue · MTD" actual={w.REV_NET?.mtd.a} budget={w.REV_NET?.mtd.t} unit={unit} foot={`YTD ${fv(w.REV_NET?.ytd.a, 'amount', unit)} of ${fv(w.REV_NET?.ytd.t, 'amount', unit)}`} />
            <KpiCard title="Recoveries · MTD" actual={w.REC_TOT?.mtd.a} budget={w.REC_TOT?.mtd.t} unit={unit} spark={trend} sparkKey="REC_TOT" />
            <KpiCard title="Payments · MTD" actual={w.PAY_TOT?.mtd.a} budget={w.PAY_TOT?.mtd.t} unit={unit} hib={0} spark={trend} sparkKey="PAY_TOT" />
            <KpiCard title="Closing cash & bank" actual={w.CB_CLOSE?.wk.a} budget={w.CB_CLOSE?.wk.t} unit={unit} spark={trend} sparkKey="CB_CLOSE" />
            <KpiCard title="Production · MTD (all units)" actual={w['ALL:PQ']?.mtd.a} budget={w['ALL:PQ']?.mtd.t} fmt="qty" unit={unit} spark={trend} sparkKey="ALL:PQ" />
          </div>

          <h2 className="part">Business development</h2>
          <div className="kgrid">
            <KpiCard title="New leads · MTD" actual={w.BD_LEADS?.mtd.a} budget={w.BD_LEADS?.mtd.t} fmt="number" unit={unit} foot={`Value ${fv(w.BD_LEADS_V?.mtd.a, 'amount', unit)}`} />
            <KpiCard title="Pipeline (open)" actual={w.BD_PIPE?.wk.a} unit={unit} spark={trend} sparkKey="BD_PIPE" />
            <KpiCard title="Orders confirmed · MTD" actual={w.BD_CONF?.mtd.a} budget={w.BD_CONF?.mtd.t} unit={unit} spark={trend} sparkKey="BD_CONF" />
            <KpiCard title="Orders to be confirmed" actual={w.BD_TBD?.wk.a} unit={unit} />
            <KpiCard title={isCo ? 'New strategic initiative' : 'Units with new initiatives'} actual={w.BD_INIT?.wk.a} fmt={isCo ? 'flag' : 'count'} unit={unit} foot={`${fv(w.BD_INIT?.ytd.a, 'count')} this year`} />
          </div>

          {mon && (
            <>
              <h2 className="part">{mon.month_label} results</h2>
              <div className="kgrid">
                <KpiCard title="Net revenue" actual={m.PL_REV?.m.a} budget={m.PL_REV?.m.b} unit={unit} spark={mtrend} sparkKey="PL_REV" />
                <KpiCard title="Gross profit" actual={m.PL_GP?.m.a} budget={m.PL_GP?.m.b} unit={unit} foot={m.PL_GP_PCT?.m.a != null ? `Margin ${fv(m.PL_GP_PCT.m.a, 'percent')}` : null} />
                <KpiCard title="EBITDA" actual={m.PL_EBITDA?.m.a} budget={m.PL_EBITDA?.m.b} unit={unit} spark={mtrend} sparkKey="PL_EBITDA" foot={m.PL_EBITDA_PCT?.m.a != null ? `Margin ${fv(m.PL_EBITDA_PCT.m.a, 'percent')}` : null} />
                <KpiCard title="Net profit" actual={m.PL_NP?.m.a} budget={m.PL_NP?.m.b} unit={unit} spark={mtrend} sparkKey="PL_NP" foot={m.PL_NP_PCT?.m.a != null ? `Margin ${fv(m.PL_NP_PCT.m.a, 'percent')}` : null} />
              </div>
            </>
          )}

          <div className="cgrid">
            {trend && (
              <ChartCard title="Net revenue by week" sub="Actual vs budget">
                <ResponsiveContainer>
                  <ComposedChart data={trend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke={C.grid} vertical={false} />
                    <XAxis dataKey="label" {...axis} />
                    <YAxis tickFormatter={ax} width={56} {...axis} />
                    <Tooltip formatter={tf} contentStyle={tip} />
                    <Legend wrapperStyle={{ fontSize: 13 }} />
                    <Bar isAnimationActive={false} dataKey="REV_NET" name="Actual" fill={C.act} radius={[3, 3, 0, 0]} barSize={18} />
                    <Line isAnimationActive={false} dataKey="REV_NET_T" name="Budget" stroke={C.bud} strokeWidth={2} strokeDasharray="5 4" dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </ChartCard>
            )}
            {trend && (
              <ChartCard title="Cash & bank" sub="Recoveries, payments and closing balance">
                <ResponsiveContainer>
                  <ComposedChart data={trend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke={C.grid} vertical={false} />
                    <XAxis dataKey="label" {...axis} />
                    <YAxis tickFormatter={ax} width={56} {...axis} />
                    <Tooltip formatter={tf} contentStyle={tip} />
                    <Legend wrapperStyle={{ fontSize: 13 }} />
                    <Bar isAnimationActive={false} dataKey="REC_TOT" name="Recoveries" fill={C.series[0]} radius={[3, 3, 0, 0]} barSize={9} />
                    <Bar isAnimationActive={false} dataKey="PAY_TOT" name="Payments" fill={C.series[2]} radius={[3, 3, 0, 0]} barSize={9} />
                    <Line isAnimationActive={false} dataKey="CB_CLOSE" name="Closing cash" stroke={C.ink} strokeWidth={2.2} dot={{ r: 2.5 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </ChartCard>
            )}
            {mix.length > 0 && (
              <ChartCard title={isCo ? 'Sales mix by SKU' : 'Net revenue mix'} sub="Month to date">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={mix} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="85%" paddingAngle={2}
                      label={({ percent }) => `${(percent * 100).toFixed(0)}%`} labelLine={false} isAnimationActive={false}>
                      {mix.map((_, i) => <Cell key={i} fill={C.series[i % C.series.length]} />)}
                    </Pie>
                    <Tooltip formatter={tf} contentStyle={tip} />
                    <Legend wrapperStyle={{ fontSize: 13 }} />
                  </PieChart>
                </ResponsiveContainer>
              </ChartCard>
            )}
            {units.length > 0 && (
              <ChartCard title={`Net revenue by ${data.children[0].type === 'company' ? 'company' : 'cluster'}`} sub="MTD actual vs budget">
                <ResponsiveContainer>
                  <BarChart data={units} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                    <CartesianGrid stroke={C.grid} horizontal={false} />
                    <XAxis type="number" tickFormatter={ax} {...axis} />
                    <YAxis type="category" dataKey="name" width={120} {...axis} />
                    <Tooltip formatter={tf} contentStyle={tip} />
                    <Legend wrapperStyle={{ fontSize: 13 }} />
                    <Bar isAnimationActive={false} dataKey="budget" name="Budget" fill={C.budBar} radius={[0, 3, 3, 0]} barSize={10} />
                    <Bar isAnimationActive={false} dataKey="actual" name="Actual" radius={[0, 3, 3, 0]} barSize={10}>
                      {units.map((u, i) => <Cell key={i} fill={u.budget && u.actual < u.budget ? C.neg : C.act} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            )}
            {prod.length > 0 && (
              <ChartCard title="Production by unit" sub="MTD actual vs budget, % of budget">
                <ResponsiveContainer>
                  <BarChart data={prod.map((p) => ({ ...p, pct: p.budget ? (p.actual / p.budget) * 100 : null }))} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke={C.grid} vertical={false} />
                    <XAxis dataKey="name" {...axis} />
                    <YAxis domain={[0, 120]} tickFormatter={(v) => `${v}%`} width={44} {...axis} />
                    <Tooltip formatter={(v) => `${Number(v).toFixed(1)}%`} contentStyle={tip} />
                    <ReferenceLine y={100} stroke={C.bud} strokeDasharray="5 4" label={{ value: 'Budget', position: 'insideTopRight', fontSize: 12, fill: C.bud }} />
                    <Bar isAnimationActive={false} dataKey="pct" name="Achieved" radius={[3, 3, 0, 0]} barSize={26}>
                      {prod.map((p, i) => <Cell key={i} fill={p.budget && p.actual < p.budget ? C.neg : C.pos} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            )}
            {mtrend && (
              <ChartCard title="Monthly profit" sub="EBITDA and net profit, actual vs budget">
                <ResponsiveContainer>
                  <ComposedChart data={mtrend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke={C.grid} vertical={false} />
                    <XAxis dataKey="label" {...axis} />
                    <YAxis tickFormatter={ax} width={56} {...axis} />
                    <Tooltip formatter={tf} contentStyle={tip} />
                    <Legend wrapperStyle={{ fontSize: 13 }} />
                    <Bar isAnimationActive={false} dataKey="PL_EBITDA" name="EBITDA" fill={C.act} radius={[3, 3, 0, 0]} barSize={14} />
                    <Bar isAnimationActive={false} dataKey="PL_NP" name="Net profit" fill={C.series[0]} radius={[3, 3, 0, 0]} barSize={14} />
                    <Line isAnimationActive={false} dataKey="PL_EBITDA_B" name="EBITDA budget" stroke={C.bud} strokeWidth={2} strokeDasharray="5 4" dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </ChartCard>
            )}
            {trend && (
              <ChartCard title="Orders & pipeline" sub="Weekly confirmed orders and open pipeline">
                <ResponsiveContainer>
                  <ComposedChart data={trend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke={C.grid} vertical={false} />
                    <XAxis dataKey="label" {...axis} />
                    <YAxis tickFormatter={ax} width={56} {...axis} />
                    <Tooltip formatter={tf} contentStyle={tip} />
                    <Legend wrapperStyle={{ fontSize: 13 }} />
                    <Area isAnimationActive={false} dataKey="BD_PIPE" name="Pipeline" fill={C.series[5]} fillOpacity={0.15} stroke={C.series[5]} />
                    <Bar isAnimationActive={false} dataKey="BD_CONF" name="Confirmed" fill={C.pos} radius={[3, 3, 0, 0]} barSize={14} />
                    <Line isAnimationActive={false} dataKey="BD_CONF_T" name="Budget" stroke={C.bud} strokeWidth={2} strokeDasharray="5 4" dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </ChartCard>
            )}
          </div>

          {data.children?.length > 0 && (
            <>
              <h2 className="part">By {data.children[0].type === 'company' ? 'company' : 'cluster'}</h2>
              <div className="ugrid">
                {data.children.map((c) => {
                  const r = c.rows;
                  const v = vr(r.REV_NET?.mtd.a, r.REV_NET?.mtd.t, 1);
                  const mc = mon?.children?.find((x) => x.id === c.id)?.rows || {};
                  return (
                    <div key={c.id} className="uc" onClick={() => setView({ nodeId: c.id })}>
                      <div className="uc-h"><Logo node={c} size="sm" /><b>{c.name}</b><span className="sp" />{c.type === 'company' ? <St s={c.status} reopened={c.reopened} /> : <StatusCounts by={c.coverage.by} />}</div>
                      <div className="uc-v">{fv(r.REV_NET?.mtd.a, 'amount', unit)} <span className="mute small">net revenue MTD</span></div>
                      <div className="kc-row"><span className="tag-b">Budget</span><span>{fv(r.REV_NET?.mtd.t, 'amount', unit)}</span><span className="sp" />{v.pct != null && <span className={`chip ${v.cls}`}>{fpct(v.pct)}</span>}</div>
                      <div className="uc-m">
                        <span>Recoveries <b>{fv(r.REC_TOT?.mtd.a, 'amount', unit)}</b></span>
                        <span>Cash <b>{fv(r.CB_CLOSE?.wk.a, 'amount', unit)}</b></span>
                        <span>Orders <b>{fv(r.BD_CONF?.mtd.a, 'amount', unit)}</b></span>
                        <span>EBITDA {mon?.month_label.slice(0, 3)} <b>{fv(mc.PL_EBITDA?.m.a, 'amount', unit) || '–'}</b></span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
