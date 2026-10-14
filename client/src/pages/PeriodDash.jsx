import { Fragment } from 'react';
import { ResponsiveContainer, ComposedChart, BarChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import { useApp } from '../store.jsx';
import { fv, vr, fpct, UNITS } from '../lib/format.js';
import { NodeSelect, UnitSelect, Loading, St, Logo, Num, PrintButton, PrintHeader, PeriodPicker, periodQuery } from '../ui.jsx';
import { useView, Crumbs, StatusCounts } from './Weekly.jsx';
import { C, ChartCard } from './Overview.jsx';

const tip = { borderRadius: 4, border: '1px solid #d0d0d0', fontFamily: 'Times New Roman', fontSize: 13, boxShadow: '0 2px 8px rgba(0,0,0,.12)' };
const axis = { tick: { fontSize: 12, fill: '#605E5C' }, axisLine: false, tickLine: false };
const flat = (d) => (d ? Object.fromEntries(d.sections.flatMap((s) => s.rows).filter((x) => x.code).map((x) => [x.code, x])) : {});
const CMP = '#8A8886';
const sum2 = (a, b) => (a == null && b == null ? null : (a || 0) + (b || 0));

// change against the comparative period (direction-aware colour)
const chg = (a, c, hib = 1) => {
  if (a == null || c == null) return { pct: null, cls: '' };
  const d = a - c;
  const pct = c ? (d / Math.abs(c)) * 100 : null;
  const good = hib ? d >= 0 : d <= 0;
  return { d, pct, cls: Math.abs(d) < 1 ? '' : good ? 'good' : 'bad' };
};

// KPI card: actual, budget with variance, comparative period with change
export function PCard({ title, x, fmt = 'amount', unit, hib = 1, cmpLabel, cmpTag, foot, a: a0, t: t0, c: c0 }) {
  const a = a0 !== undefined ? a0 : x?.p.a ?? null;
  const t = t0 !== undefined ? t0 : x?.p.t ?? null;
  const c = c0 !== undefined ? c0 : x?.c.a ?? null;
  const v = vr(a, t, hib, fmt);
  const k = chg(a, c, hib);
  const pct = t ? Math.max(0, Math.min(150, (a / t) * 100)) : null;
  return (
    <div className="kc pcard">
      <div className="kc-t" title={title}>{title}</div>
      <div className="kc-v" title={a == null ? '' : fv(a, fmt, '1')}>{a == null || a === 0 ? '0' : fv(a, fmt, unit)}</div>
      <div className="kc-row pc">
        <span className="tag-b">Budget</span><span>{t == null ? '–' : fv(t, fmt, unit) || '0'}</span>
        <span className="sp" />
        {v.pct != null && <span className={`chip ${v.cls}`}>{v.pct > 0 ? '▲' : v.pct < 0 ? '▼' : ''} {fpct(v.pct)}</span>}
      </div>
      <div className="kc-bar" title={pct != null ? `${(a / t * 100).toFixed(1)}% of budget` : ''}>
        {pct != null && <><i style={{ width: `${Math.min(100, pct / 1.5)}%`, background: v.cls === 'bad' ? C.neg : C.act }} /><b style={{ left: `${100 / 1.5}%` }} /></>}
      </div>
      <div className="kc-row pc">
        <span className="tag-c" title={cmpLabel}>{/FY|20/.test(cmpLabel || "") && cmpTag ? cmpTag : cmpLabel}</span><span>{c == null ? '–' : fv(c, fmt, unit) || '0'}</span>
        <span className="sp" />
        {k.pct != null && <span className={`chip ${k.cls}`}>{k.pct > 0 ? '▲' : k.pct < 0 ? '▼' : ''} {fpct(k.pct)}</span>}
      </div>
      {foot && <div className="kc-foot">{foot}</div>}
    </div>
  );
}

const emptyRow = (x) => !x.group && [x.p?.a, x.p?.t, x.c?.a].every((v) => v == null || v === 0);

// full statement for the period: actual vs budget vs comparative
export function PeriodStatement({ data, unit }) {
  const cols = 9;
  return (
    <div className="wrap">
      <table className="r">
        <thead>
          <tr className="g">
            <th className="l first" />
            <th colSpan={4} className="gap">{data.label}</th>
            <th colSpan={3} className="gap">vs {data.compare_label}</th>
          </tr>
          <tr>
            <th className="l first" style={{ minWidth: 230 }} />
            <th className="gap">Budget</th><th>Actual</th><th>Var</th><th>%</th>
            <th className="gap">{data.compare_label.split(' · ')[0]}</th><th>Change</th><th>%</th>
          </tr>
        </thead>
        <tbody>
          {data.sections.map((s) => {
            const rows = s.rows.filter((x) => !emptyRow(x));
            if (!rows.some((x) => !x.group)) return null;
            return (
              <Fragment key={s.code}>
                <tr className="sec"><td colSpan={cols} className="first">{s.name}</td></tr>
                {rows.map((x0, i) => {
                  if (x0.group) return <tr key={`g${i}`} className="grp"><td colSpan={cols} className="l first">{x0.name}</td></tr>;
                  const x = x0.fmt === 'flag' ? { ...x0, fmt: 'count' } : x0;
                  const op = x.nature === 'opening';
                  const v = vr(x.p.a, x.p.t, x.hib, x.fmt);
                  const k = chg(x.p.a, x.c.a, x.hib);
                  return (
                    <tr key={x.code} className={x.grand ? 'grand' : x.strong ? 'tot' : ''}>
                      <td className="l first" style={{ paddingLeft: 8 + (x.depth || 0) * 16 }}>{x.name}</td>
                      <Num className="gap lock" v={op ? null : x.p.t} fmt={x.fmt} unit={unit} />
                      <Num v={x.p.a} fmt={x.fmt} unit={unit} />
                      <Num className={v.cls} v={op ? null : v.d} fmt={x.fmt} unit={unit} />
                      <td className={`n ${v.cls}`}>{op ? '' : fpct(v.pct)}</td>
                      <Num className="gap lock" v={x.c.a} fmt={x.fmt} unit={unit} />
                      <Num className={k.cls} v={op || x.fmt === 'percent' ? null : k.d} fmt={x.fmt} unit={unit} />
                      <td className={`n ${k.cls}`}>{op || x.fmt === 'percent' ? '' : fpct(k.pct)}</td>
                    </tr>
                  );
                })}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// key lines for each cluster / company, actual vs budget vs comparative
function UnitTable({ data, unit, onPick }) {
  const K = [['REV_NET', 'Net revenue', 1], ['REC_TOT', 'Recoveries', 1], ['PL_EBITDA', 'EBITDA', 1], ['PL_NP', 'Net profit', 1], ['CAPINV', 'Capex & investments', 0], ['CB_CLOSE', 'Closing cash', 1]];
  const val = (rows, k) => (k === 'CAPINV'
    ? { p: { a: sum2(rows.PAY_INV?.p.a, rows.PAY_INVM?.p.a), t: sum2(rows.PAY_INV?.p.t, rows.PAY_INVM?.p.t) }, c: { a: sum2(rows.PAY_INV?.c.a, rows.PAY_INVM?.c.a) } }
    : rows[k] || { p: {}, c: {} });
  return (
    <div className="wrap">
      <table className="r">
        <thead>
          <tr className="g"><th className="l first" />{K.map(([k, n]) => <th key={k} colSpan={3} className="gap">{n}</th>)}</tr>
          <tr><th className="l first" />{K.map(([k]) => <Fragment key={k}><th className="gap">Actual</th><th>vs bud.</th><th>vs cmp.</th></Fragment>)}</tr>
        </thead>
        <tbody>
          {data.children.map((c) => (
            <tr key={c.id} className="click" onClick={() => onPick(c.id)}>
              <td className="l first">{c.name}</td>
              {K.map(([k, , hib]) => {
                const x = val(c.rows, k);
                const v = vr(x.p.a, x.p.t, hib);
                const g = chg(x.p.a, x.c.a, hib);
                return (
                  <Fragment key={k}>
                    <Num className="gap" v={x.p.a} fmt="amount" unit={unit} />
                    <td className={`n ${v.cls}`}>{fpct(v.pct)}</td>
                    <td className={`n ${g.cls}`}>{fpct(g.pct)}</td>
                  </Fragment>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function usePeriod() {
  const { view, periods } = useApp();
  const q = periodQuery(view, periods);
  return useView('/view/period', { node: view.nodeId, ...q }, [view.nodeId, q.mode, q.month, q.fy, q.q, q.h, q.cmp]);
}

// dashboard for a month / quarter / year
export default function PeriodDash({ modeBar }) {
  const { view, setView } = useApp();
  const unit = view.unit;
  const { data, err } = usePeriod();
  const f = flat(data);
  const cl = data?.compare_label.split(' · ')[0];
  const tagC = data?.cmp === 'ly' ? 'LY' : 'Prior';
  const ax = (v) => fv(v, 'amount', 'm');
  const tf = (v) => fv(v, 'amount', unit);
  const s = data?.series || [];
  const one = s.length === 1;
  const hasPL = ['PL_REV', 'PL_GP', 'PL_EBITDA', 'PL_NP'].some((k) => f[k]?.p.a != null || f[k]?.c.a != null || f[k]?.p.t != null);
  const capA = sum2(f.PAY_INV?.p.a, f.PAY_INVM?.p.a);
  const bars = one ? [
    ['Net revenue', 'REV_NET'], ['Recoveries', 'REC_TOT'], ['Payments', 'PAY_TOT'], ['Capex', 'PAY_INV'], ['Investments', 'PAY_INVM'], ['Orders confirmed', 'BD_CONF'],
  ].map(([name, k]) => ({ name, actual: f[k]?.p.a ?? null, budget: f[k]?.p.t ?? null, cmp: f[k]?.c.a ?? null })) : [];

  return (
    <>
      <div className="bar">
        <NodeSelect value={view.nodeId} onChange={(id) => setView({ nodeId: id })} />
        {modeBar}
        <PeriodPicker />
        <UnitSelect />
        <span className="sp" />
        <PrintButton />
      </div>
      {err && <div className="note err">{err}</div>}
      {!data ? <Loading /> : (
        <div className="dash">
          <PrintHeader node={data.node} title="Dashboard" period={`${data.label} · vs ${data.compare_label} · ${UNITS[unit].label}`} />
          <Crumbs path={data.path} onPick={(id) => setView({ nodeId: id })} />
          <div className="title">
            <Logo node={data.node} />
            <h1>{data.node.name}</h1>
            <span className="meta">{data.label}{data.through ? ` to ${data.through.slice(8)}-${data.through.slice(5, 7)}` : ''} · vs {data.compare_label} · {UNITS[unit].label}</span>
            <span className="sp" />
            {data.node.type === 'company' ? <St s={data.coverage.status[0]?.status} reopened={data.coverage.status[0]?.reopened} /> : <StatusCounts by={data.coverage.by} />}
          </div>
          <div className="legend-line"><span><i style={{ background: C.act }} />Actual</span><span><i style={{ background: C.bud }} />Budget</span><span><i style={{ background: CMP }} />{data.compare_label}</span><span><i style={{ background: C.pos }} />Better</span><span><i style={{ background: C.neg }} />Worse</span></div>
          {data.future ? <div className="empty">Period not started.</div> : (
            <>
              <h2 className="part">Revenue & cash</h2>
              <div className="kgrid pgrid">
                <PCard title="Net revenue" x={f.REV_NET} unit={unit} cmpLabel={cl} cmpTag={tagC} />
                <PCard title="Recoveries" x={f.REC_TOT} unit={unit} cmpLabel={cl} cmpTag={tagC} />
                <PCard title="Payments" x={f.PAY_TOT} unit={unit} hib={0} cmpLabel={cl} cmpTag={tagC} />
                <PCard title="Closing cash & bank" x={f.CB_CLOSE} unit={unit} cmpLabel={cl} cmpTag={tagC} />
                <PCard title="Production (all units)" x={f['ALL:PQ']} fmt="qty" unit={unit} cmpLabel={cl} cmpTag={tagC} foot={f['ALL:SQ']?.p.a != null ? `Sales volume ${fv(f['ALL:SQ'].p.a, 'qty')}` : null} />
              </div>

              {hasPL && (
                <>
                  <h2 className="part">Profitability <span className="mute small">closed months</span></h2>
                  <div className="kgrid pgrid">
                    <PCard title="Net revenue (P&L)" x={f.PL_REV} unit={unit} cmpLabel={cl} cmpTag={tagC} />
                    <PCard title="Gross profit" x={f.PL_GP} unit={unit} cmpLabel={cl} cmpTag={tagC} foot={f.PL_GP_PCT?.p.a != null ? `Margin ${fv(f.PL_GP_PCT.p.a, 'percent')}${f.PL_GP_PCT.c.a != null ? ` · ${cl} ${fv(f.PL_GP_PCT.c.a, 'percent')}` : ''}` : null} />
                    <PCard title="EBITDA" x={f.PL_EBITDA} unit={unit} cmpLabel={cl} cmpTag={tagC} foot={f.PL_EBITDA_PCT?.p.a != null ? `Margin ${fv(f.PL_EBITDA_PCT.p.a, 'percent')}${f.PL_EBITDA_PCT.c.a != null ? ` · ${cl} ${fv(f.PL_EBITDA_PCT.c.a, 'percent')}` : ''}` : null} />
                    <PCard title="Net profit" x={f.PL_NP} unit={unit} cmpLabel={cl} cmpTag={tagC} foot={f.PL_NP_PCT?.p.a != null ? `Margin ${fv(f.PL_NP_PCT.p.a, 'percent')}${f.PL_NP_PCT.c.a != null ? ` · ${cl} ${fv(f.PL_NP_PCT.c.a, 'percent')}` : ''}` : null} />
                  </div>
                </>
              )}

              <h2 className="part">Capex & investments</h2>
              <div className="kgrid pgrid">
                <PCard title="Capex" x={f.PAY_INV} unit={unit} hib={0} cmpLabel={cl} cmpTag={tagC} />
                <PCard title="Investments" x={f.PAY_INVM} unit={unit} hib={0} cmpLabel={cl} cmpTag={tagC} />
                <PCard title="Investing inflows" x={f.REC_INV} unit={unit} cmpLabel={cl} cmpTag={tagC} />
                <PCard title="Net investing" x={f.NET_INV} unit={unit} hib={0} cmpLabel={cl} cmpTag={tagC} foot={capA != null && f.PAY_TOT?.p.a ? `${((capA / f.PAY_TOT.p.a) * 100).toFixed(1)}% of payments` : null} />
              </div>

              <h2 className="part">Business development</h2>
              <div className="kgrid pgrid">
                <PCard title="New leads" x={f.BD_LEADS} fmt="number" unit={unit} cmpLabel={cl} cmpTag={tagC} foot={f.BD_LEADS_V?.p.a != null ? `Value ${fv(f.BD_LEADS_V.p.a, 'amount', unit)}` : null} />
                <PCard title="Orders confirmed" x={f.BD_CONF} unit={unit} cmpLabel={cl} cmpTag={tagC} />
                <PCard title="Pipeline · period end" x={f.BD_PIPE} unit={unit} cmpLabel={cl} cmpTag={tagC} />
                <PCard title="Initiative weeks" x={f.BD_INIT} fmt="count" unit={unit} cmpLabel={cl} cmpTag={tagC} />
              </div>

              <div className="cgrid">
                {one ? (
                  <ChartCard title="Actual, budget and comparative" sub={`${data.label} · ${cl}`} h={300}>
                    <ResponsiveContainer>
                      <BarChart data={bars} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid stroke={C.grid} vertical={false} />
                        <XAxis dataKey="name" {...axis} interval={0} tick={{ fontSize: 11.5, fill: '#605E5C' }} />
                        <YAxis tickFormatter={ax} width={56} {...axis} />
                        <Tooltip formatter={tf} contentStyle={tip} />
                        <Legend wrapperStyle={{ fontSize: 13 }} />
                        <Bar isAnimationActive={false} dataKey="actual" name="Actual" fill={C.act} radius={[3, 3, 0, 0]} />
                        <Bar isAnimationActive={false} dataKey="budget" name="Budget" fill={C.bud} radius={[3, 3, 0, 0]} />
                        <Bar isAnimationActive={false} dataKey="cmp" name={cl} fill={CMP} radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </ChartCard>
                ) : (
                  <ChartCard title="Net revenue by month" sub={`Actual vs budget vs ${cl}`}>
                    <ResponsiveContainer>
                      <ComposedChart data={s} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid stroke={C.grid} vertical={false} />
                        <XAxis dataKey="label" {...axis} />
                        <YAxis tickFormatter={ax} width={56} {...axis} />
                        <Tooltip formatter={tf} contentStyle={tip} />
                        <Legend wrapperStyle={{ fontSize: 13 }} />
                        <Bar isAnimationActive={false} dataKey="REV_NET" name="Actual" fill={C.act} radius={[3, 3, 0, 0]} barSize={22} />
                        <Line isAnimationActive={false} dataKey="REV_NET_B" name="Budget" stroke={C.bud} strokeWidth={2} strokeDasharray="5 4" dot={false} />
                        <Line isAnimationActive={false} dataKey="REV_NET_C" name={cl} stroke={CMP} strokeWidth={2} dot={{ r: 2.5 }} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </ChartCard>
                )}
                {!one && hasPL && (
                  <ChartCard title="Profit by month" sub="EBITDA and net profit">
                    <ResponsiveContainer>
                      <ComposedChart data={s} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid stroke={C.grid} vertical={false} />
                        <XAxis dataKey="label" {...axis} />
                        <YAxis tickFormatter={ax} width={56} {...axis} />
                        <Tooltip formatter={tf} contentStyle={tip} />
                        <Legend wrapperStyle={{ fontSize: 13 }} />
                        <Bar isAnimationActive={false} dataKey="PL_EBITDA" name="EBITDA" fill={C.act} radius={[3, 3, 0, 0]} barSize={14} />
                        <Bar isAnimationActive={false} dataKey="PL_NP" name="Net profit" fill={C.series[0]} radius={[3, 3, 0, 0]} barSize={14} />
                        <Line isAnimationActive={false} dataKey="PL_EBITDA_B" name="EBITDA budget" stroke={C.bud} strokeWidth={2} strokeDasharray="5 4" dot={false} />
                        <Line isAnimationActive={false} dataKey="PL_EBITDA_C" name={`EBITDA ${cl}`} stroke={CMP} strokeWidth={2} dot={{ r: 2.5 }} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </ChartCard>
                )}
                <ChartCard title="Capex & investments" sub={one ? `${data.label} vs budget vs ${cl}` : 'By month'}>
                  <ResponsiveContainer>
                    {one ? (
                      <BarChart data={[['Capex', 'PAY_INV'], ['Investments', 'PAY_INVM'], ['Inflows', 'REC_INV'], ['Net investing', 'NET_INV']].map(([name, k]) => ({ name, actual: f[k]?.p.a ?? null, budget: f[k]?.p.t ?? null, cmp: f[k]?.c.a ?? null }))} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid stroke={C.grid} vertical={false} />
                        <XAxis dataKey="name" {...axis} />
                        <YAxis tickFormatter={ax} width={56} {...axis} />
                        <Tooltip formatter={tf} contentStyle={tip} />
                        <Legend wrapperStyle={{ fontSize: 13 }} />
                        <Bar isAnimationActive={false} dataKey="actual" name="Actual" fill={C.series[5]} radius={[3, 3, 0, 0]} />
                        <Bar isAnimationActive={false} dataKey="budget" name="Budget" fill={C.bud} radius={[3, 3, 0, 0]} />
                        <Bar isAnimationActive={false} dataKey="cmp" name={cl} fill={CMP} radius={[3, 3, 0, 0]} />
                      </BarChart>
                    ) : (
                      <ComposedChart data={s} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid stroke={C.grid} vertical={false} />
                        <XAxis dataKey="label" {...axis} />
                        <YAxis tickFormatter={ax} width={56} {...axis} />
                        <Tooltip formatter={tf} contentStyle={tip} />
                        <Legend wrapperStyle={{ fontSize: 13 }} />
                        <Bar isAnimationActive={false} dataKey="PAY_INV" name="Capex" stackId="i" fill={C.series[5]} barSize={22} />
                        <Bar isAnimationActive={false} dataKey="PAY_INVM" name="Investments" stackId="i" fill={C.series[3]} radius={[3, 3, 0, 0]} barSize={22} />
                        <Line isAnimationActive={false} dataKey="REC_INV" name="Inflows" stroke={C.pos} strokeWidth={2} dot={{ r: 2.5 }} />
                        <Line isAnimationActive={false} dataKey="NET_INV_C" name={`Net investing ${cl}`} stroke={CMP} strokeWidth={2} strokeDasharray="5 4" dot={false} />
                      </ComposedChart>
                    )}
                  </ResponsiveContainer>
                </ChartCard>
                {!one && (
                  <ChartCard title="Cash & bank by month" sub="Recoveries, payments and closing balance">
                    <ResponsiveContainer>
                      <ComposedChart data={s} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid stroke={C.grid} vertical={false} />
                        <XAxis dataKey="label" {...axis} />
                        <YAxis tickFormatter={ax} width={56} {...axis} />
                        <Tooltip formatter={tf} contentStyle={tip} />
                        <Legend wrapperStyle={{ fontSize: 13 }} />
                        <Bar isAnimationActive={false} dataKey="REC_TOT" name="Recoveries" fill={C.series[0]} radius={[3, 3, 0, 0]} barSize={12} />
                        <Bar isAnimationActive={false} dataKey="PAY_TOT" name="Payments" fill={C.series[2]} radius={[3, 3, 0, 0]} barSize={12} />
                        <Line isAnimationActive={false} dataKey="CB_CLOSE" name="Closing cash" stroke={C.ink} strokeWidth={2.2} dot={{ r: 2.5 }} />
                        <Line isAnimationActive={false} dataKey="CB_CLOSE_C" name={`Closing ${cl}`} stroke={CMP} strokeWidth={2} strokeDasharray="5 4" dot={false} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </ChartCard>
                )}
              </div>

              {data.children?.length > 0 && (
                <>
                  <h2 className="part">By {data.children[0].type === 'company' ? 'company' : 'cluster'}</h2>
                  <UnitTable data={data} unit={unit} onPick={(id) => setView({ nodeId: id })} />
                </>
              )}

              <h2 className="part">Statement</h2>
              <PeriodStatement data={data} unit={unit} />
            </>
          )}
        </div>
      )}
    </>
  );
}

// report page body for quarter / year (used by Monthly)
export function PeriodReport({ modeBar }) {
  const { view, setView } = useApp();
  const unit = view.unit;
  const { data, err } = usePeriod();
  return (
    <>
      <div className="bar">
        <NodeSelect value={view.nodeId} onChange={(id) => setView({ nodeId: id })} />
        {modeBar}
        <PeriodPicker />
        <UnitSelect />
        <span className="sp" />
        <PrintButton />
      </div>
      {err && <div className="note err">{err}</div>}
      {!data ? <Loading /> : (
        <>
          <PrintHeader node={data.node} title="Period report" period={`${data.label} · vs ${data.compare_label} · ${UNITS[unit].label}`} />
          <Crumbs path={data.path} onPick={(id) => setView({ nodeId: id })} />
          <div className="title">
            <Logo node={data.node} />
            <h1>{data.node.name}</h1>
            <span className="meta">{data.label} · vs {data.compare_label} · {UNITS[unit].label}</span>
            <span className="sp" />
            {data.node.type === 'company' ? <St s={data.coverage.status[0]?.status} reopened={data.coverage.status[0]?.reopened} /> : <StatusCounts by={data.coverage.by} />}
          </div>
          {data.future ? <div className="empty">Period not started.</div> : (
            <>
              <PeriodStatement data={data} unit={unit} />
              {data.children?.length > 0 && (
                <>
                  <h2 className="part">By {data.children[0].type === 'company' ? 'company' : 'cluster'}</h2>
                  <UnitTable data={data} unit={unit} onPick={(id) => setView({ nodeId: id })} />
                </>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}
