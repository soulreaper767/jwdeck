import { Fragment, useState } from 'react';
import { useApp } from '../store.jsx';
import { vr, fpct, toCSV, download, UNITS } from '../lib/format.js';
import { NodeSelect, MonthSelect, UnitSelect, Seg, Loading, Num, St, Logo, PrintButton, PrintHeader } from '../ui.jsx';
import { useView, Crumbs, StatusCounts } from './Weekly.jsx';
import { PeriodReport } from './PeriodDash.jsx';

const emptyMonthRow = (x) => !x.group && [x.m?.a, x.m?.b, x.y?.a, x.y?.b, x.adj, ...(x.cols || [])].every((v) => v == null || v === 0);

export const KEY_MONTH = ['PL_REV', 'PL_GP', 'PL_GP_PCT', 'PL_EBITDA', 'PL_EBITDA_PCT', 'PL_NP', 'CF_NET', 'CF_CLOSE', 'ALL:PQ', 'ALL:SQ'];

function BA({ p, x, unit }) {
  const op = x.nature === 'opening';
  const v = vr(p?.a, p?.b, x.hib, x.fmt);
  return (
    <>
      <Num className="gap lock" v={op ? null : p?.b} fmt={x.fmt} unit={unit} />
      <Num v={p?.a} fmt={x.fmt} unit={unit} />
      <Num className={v.cls} v={op ? null : v.d} fmt={x.fmt} unit={unit} />
      <td className={`n ${v.cls}`}>{op ? '' : fpct(v.pct)}</td>
    </>
  );
}

function Head({ data, weeks, cmp, recon }) {
  return (
    <thead>
      <tr className="g">
        <th className="l first" />
        {weeks && <th colSpan={data.columns.length + 1} className="gap">Weeks</th>}
        <th colSpan={4} className="gap">{data.month_label}{data.complete ? '' : ` · to ${data.through ? data.through.slice(8) + ' ' + data.month_label.slice(0, 3) : '—'}`}</th>
        <th colSpan={4} className="gap">YTD · {data.fy_label}</th>
        {cmp && <th colSpan={3} className="gap">vs {cmp}</th>}
        {recon && <th colSpan={4} className="gap">Reconciliation · weeks to month</th>}
      </tr>
      <tr>
        <th className="l first" style={{ minWidth: 220 }} />
        {weeks && <>{data.columns.map((c, i) => <th key={c.week} className={i === 0 ? 'gap' : ''}>{c.week.slice(5)}<br /><span className="mute">{c.label}</span></th>)}<th>Adj.</th></>}
        <th className="gap">Budget</th><th>Actual</th><th>Var</th><th>%</th>
        <th className="gap">Budget</th><th>Actual</th><th>Var</th><th>%</th>
        {cmp && <><th className="gap">{cmp.split(' · ')[0]}</th><th>Change</th><th>%</th></>}
        {recon && <><th className="gap" title="Weekly figures as first submitted">As reported</th><th>Adjustments</th><th>Re-filed</th><th>= Month</th></>}
      </tr>
    </thead>
  );
}

function Row({ x: x0, unit, weeks, ncols, cmp, c, recon }) {
  const x = x0.fmt === 'flag' ? { ...x0, fmt: 'count' } : x0;
  return (
    <tr className={x.grand ? 'grand' : x.strong ? 'tot' : ''}>
      <td className="l first" style={{ paddingLeft: 8 + (x.depth || 0) * 16 }}>{x.name}</td>
      {weeks && <>{(x.cols || Array(ncols).fill(null)).map((c, j) => <Num key={j} className={j === 0 ? 'gap' : ''} v={c} fmt={x.fmt} unit={unit} />)}<Num v={x.adj} fmt={x.fmt} unit={unit} /></>}
      <BA p={x.m} x={x} unit={unit} />
      <BA p={x.y} x={x} unit={unit} />
      {cmp && (() => {
        const op = x.nature === 'opening' || x.fmt === 'percent';
        const d = x.m?.a != null && c != null ? x.m.a - c : null;
        const pct = d != null && c ? (d / Math.abs(c)) * 100 : null;
        const cls = d == null || Math.abs(d) < 1 ? '' : (x.hib ? d >= 0 : d <= 0) ? 'good' : 'bad';
        return <><Num className="gap lock" v={c} fmt={x.fmt} unit={unit} /><Num className={cls} v={op ? null : d} fmt={x.fmt} unit={unit} /><td className={`n ${cls}`}>{op ? '' : fpct(pct)}</td></>;
      })()}
      {recon && (x.recon ? <>
        <Num className="gap lock" v={x.recon.reported} fmt={x.fmt} unit={unit} />
        {x.recon.adj ? <Num className="adjv" v={x.recon.adj} fmt={x.fmt} unit={unit} /> : <td className="n zero">0</td>}
        {x.recon.refiled ? <Num className="adjv" v={x.recon.refiled} fmt={x.fmt} unit={unit} /> : <td className="n zero">0</td>}
        <Num className="tot-c" v={x.recon.month} fmt={x.fmt} unit={unit} />
      </> : <><td className="gap" /><td /><td /><td /></>)}
    </tr>
  );
}

const RMODES = [['month', 'Month'], ['quarter', 'Quarter'], ['year', 'Year']];
function RModeSeg() {
  const { view, setView } = useApp();
  return <Seg value={view.pmode && view.pmode !== 'week' ? view.pmode : 'month'} options={RMODES} onChange={(m) => setView({ pmode: m })} />;
}

export default function Monthly() {
  const { view } = useApp();
  if (view.pmode === 'quarter' || view.pmode === 'year') return <PeriodReport modeBar={<RModeSeg />} />;
  return <MonthReport />;
}

function MonthReport() {
  const { view, setView, periods } = useApp();
  const month = view.pmonth || (view.month && /^\d{4}-\d{2}$/.test(view.month) ? view.month : periods?.last_month);
  const cmpMode = view.pcmp || 'prev';
  const { data: cmpData } = useView('/view/period', { node: view.nodeId, mode: 'month', month, cmp: cmpMode }, [view.nodeId, month, cmpMode]);
  const cflat = cmpData ? Object.fromEntries(cmpData.sections.flatMap((s) => s.rows).filter((x) => x.code).map((x) => [x.code, x.c.a])) : {};
  const cchild = (id, code) => cmpData?.children?.find((x) => x.id === id)?.rows[code]?.c.a ?? null;
  const cmp = cmpData?.compare_label;
  const [weeks, setWeeks] = useState(false);
  const [recon, setRecon] = useState(true);
  const [full, setFull] = useState(false);
  const { data, err } = useView('/view/month', { node: view.nodeId, month }, [view.nodeId, month]);
  const unit = view.unit;
  const cols = data ? 1 + (weeks ? data.columns.length + 1 : 0) + 8 + (cmp ? 3 : 0) + (recon ? 4 : 0) : 1;
  const allRows = data ? data.sections.flatMap((s) => s.rows).filter((x) => x.code) : [];

  const exportCsv = () => {
    const out = [['Unit', 'Line', ...data.columns.map((c) => `${c.week} ${c.label}`), 'Adj', 'Budget', 'Actual', 'YTD budget', 'YTD actual']];
    for (const s of data.sections) for (const x of s.rows) if (!x.group) out.push([data.node.name, x.name, ...x.cols, x.adj, x.m.b, x.m.a, x.y.b, x.y.a]);
    for (const c of data.children || []) for (const x of allRows) if (c.rows[x.code]) { const r = c.rows[x.code]; out.push([c.name, x.name, ...r.cols, r.adj, r.m.b, r.m.a, r.y.b, r.y.a]); }
    download(`JW-monthly-${data.node.name}-${data.month}.csv`, toCSV(out));
  };

  return (
    <>
      <div className="bar">
        <NodeSelect value={view.nodeId} onChange={(id) => setView({ nodeId: id })} />
        <RModeSeg />
        <MonthSelect value={month} onChange={(m) => setView({ month: m, pmonth: m })} />
        <Seg value={cmpMode} options={[['prev', 'vs prev. month'], ['ly', 'vs last year']]} onChange={(c) => setView({ pcmp: c })} />
        <UnitSelect />
        <label className="c"><input type="checkbox" checked={weeks} onChange={(e) => setWeeks(e.target.checked)} />Weeks</label>
        <label className="c"><input type="checkbox" checked={recon} onChange={(e) => setRecon(e.target.checked)} />Reconciliation</label>
        <span className="sp" />
        {data && <button onClick={exportCsv}>Export</button>}
        <PrintButton />
      </div>
      {err && <div className="note err">{err}</div>}
      {!data ? <Loading /> : (
        <>
          <PrintHeader node={data.node} title="Monthly report" period={`${data.month_label} · ${data.fy_label} · ${UNITS[unit].label}`} />
          <Crumbs path={data.path} onPick={(id) => setView({ nodeId: id })} />
          <div className="title">
            <Logo node={data.node} />
            <h1>{data.node.name}</h1>
            <span className="meta">{data.month_label} · {data.fy_label} · {UNITS[unit].label}</span>
            <span className="sp" />
            {data.node.type === 'company' ? <St s={data.coverage.status[0]?.status} reopened={data.coverage.status[0]?.reopened} /> : <StatusCounts by={data.coverage.by} />}
          </div>

          {data.children && <h2 className="part">{data.node.type === 'group' ? 'Group summary' : 'Cluster summary'}</h2>}
          <div className="wrap">
            <table className="r">
              <Head data={data} weeks={weeks} cmp={cmp} recon={recon} />
              <tbody>
                {data.sections.map((s) => (
                  <Fragment key={s.code}>
                    <tr className="sec"><td colSpan={cols} className="first">{s.name}</td></tr>
                    {s.rows.filter((x) => !emptyMonthRow(x)).map((x, i) => (x.group
                      ? <tr key={`g${i}`} className="grp"><td colSpan={cols} className="l first">{x.name}</td></tr>
                      : <Row key={x.code} x={x} unit={unit} weeks={weeks} ncols={data.columns.length} cmp={cmp} c={cflat[x.code] ?? null} recon={recon} />))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          {recon && (
            <div className="cc" style={{ marginTop: 16 }}>
              <div className="cc-h"><span className="cc-t">Changes in {data.month_label}</span><span className="cc-s">prior-week adjustments and re-filed weeks</span></div>
              {!data.changes?.length ? <div className="small"><b>0</b> · weekly figures stand as reported</div> : (
                <table className="r pbi">
                  <thead><tr><th className="l">Company</th><th className="l">Week</th><th className="l">Change</th><th>Amount</th><th className="l">Reason</th></tr></thead>
                  <tbody>{data.changes.map((n, i) => (
                    <tr key={i}>
                      <td className="l">{n.company}</td><td className="l">{n.week.slice(5)}</td>
                      <td className="l">{n.type === 'adjustment' ? n.line : `Re-filed (revision ${n.revision})`}</td>
                      {n.type === 'adjustment' ? <Num className="adjv" v={n.value} fmt="amount" unit={unit} /> : <td />}
                      <td className="l">{n.reason}</td>
                    </tr>
                  ))}</tbody>
                </table>
              )}
            </div>
          )}
          {data.children?.length > 0 && (
            <>
              <div className="row" style={{ marginTop: 10 }}>
                <h2 className="part" style={{ flex: 1 }}>By {data.children[0].type === 'company' ? 'company' : 'cluster'}</h2>
                <Seg value={full ? 'f' : 'k'} options={[['k', 'Key lines'], ['f', 'Full pack']]} onChange={(v) => setFull(v === 'f')} />
              </div>
              {data.children.map((c) => (
                <div className="unit" key={c.id}>
                  <div className="uh" onClick={() => setView({ nodeId: c.id })}>
                    <Logo node={c} size="sm" /><h3>{c.name}</h3><span className="sp" />
                    {c.type === 'company' ? <St s={c.status} reopened={c.reopened} /> : <StatusCounts by={c.coverage.by} />}
                    <span className="small">open ›</span>
                  </div>
                  <div className="wrap">
                    <table className="r">
                      <Head data={data} weeks={weeks} cmp={cmp} />
                      <tbody>
                        {(full ? allRows : KEY_MONTH.map((k) => allRows.find((x) => x.code === k)).filter(Boolean)).map((x) => (
                          c.rows[x.code] ? <Row key={x.code} x={{ ...x, ...c.rows[x.code], name: x.name, depth: full ? x.depth : 0 }} unit={unit} weeks={weeks} ncols={data.columns.length} cmp={cmp} c={cchild(c.id, x.code)} /> : null
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </>
          )}
        </>
      )}
    </>
  );
}
