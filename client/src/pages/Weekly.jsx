import { Fragment, useEffect, useState } from 'react';
import { useApp } from '../store.jsx';
import { api, qs } from '../lib/api.js';
import { fv, vr, fpct, toCSV, download, UNITS } from '../lib/format.js';
import { NodeSelect, WeekSelect, UnitSelect, Seg, Loading, Num, St, Logo, STATUS, PrintButton, PrintHeader } from '../ui.jsx';

export function useView(path, params, deps) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (Object.values(params).some((v) => v == null)) return undefined;
    let live = true;
    setErr('');
    api.get(`${path}${qs(params)}`).then((r) => live && setData(r)).catch((e) => live && setErr(e.message));
    return () => { live = false; };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return { data, err };
}

export const KEY_WEEK = ['REV_GROSS', 'REV_NET', 'REC_TOT', 'ALL:PQ', 'ALL:SQ', 'PAY_TOT', 'NETCF', 'CB_CLOSE'];

export function Crumbs({ path, onPick }) {
  return (
    <div className="small mute">
      {path.slice(0, -1).map((p) => <span key={p.id}><button className="link" onClick={() => onPick(p.id)}>{p.name}</button> › </span>)}
    </div>
  );
}

export function StatusCounts({ by }) {
  const order = ['approved', 'cluster_ok', 'company_ok', 'submitted', 'reopened', 'draft', 'new', 'lapsed'];
  return <span className="row small">{order.filter((k) => by?.[k]).map((k) => <span key={k}><St s={k} /> {by[k]}</span>)}</span>;
}

function TA({ p, x, unit }) {
  const opening = x.nature === 'opening';
  const v = vr(p?.a, p?.t, x.hib, x.fmt);
  return (
    <>
      <Num className="gap lock" v={opening ? null : p?.t} fmt={x.fmt} unit={unit} />
      <Num v={p?.a} fmt={x.fmt} unit={unit} />
      <Num className={v.cls} v={opening ? null : v.d} fmt={x.fmt} unit={unit} />
      <td className={`n ${v.cls}`}>{opening ? '' : fpct(v.pct)}</td>
    </>
  );
}

const asCount = (x) => (x.fmt === 'flag' ? { ...x, fmt: 'count' } : x);
export const emptyWeekRow = (x) => !x.group && [x.wk?.a, x.wk?.t, x.mtd?.a, x.mtd?.t, x.ytd?.a, x.ytd?.t, x.adj].every((v) => v == null || v === 0);

function Head({ data, ytd, recon, adj }) {
  return (
    <thead>
      <tr className="g">
        <th className="l first" />
        <th colSpan={4} className="gap">Week · {data.week.label.split(' · ')[1]}</th>
        <th colSpan={4} className="gap">MTD · {data.month_label}</th>
        {ytd && <th colSpan={4} className="gap">YTD · {data.fy_label}</th>}
        {adj && <th className="gap">Prior wk</th>}
        {recon && <th colSpan={3} className="gap">MTD reconciliation</th>}
      </tr>
      <tr>
        <th className="l first" style={{ minWidth: 220 }} />
        {[0, 1, ...(ytd ? [2] : [])].map((i) => <Fragment key={i}><th className="gap">Target</th><th>Actual</th><th>Var</th><th>%</th></Fragment>)}
        {adj && <th className="gap">Adj.</th>}
        {recon && <><th className="gap">Reported</th><th>+ This wk</th><th>Diff</th></>}
      </tr>
    </thead>
  );
}

function Row({ x, unit, ytd, recon, adj, flag = true }) {
  return (
    <tr className={`${x.grand ? 'grand' : x.strong ? 'tot' : ''} ${flag && x.diff ? 'flag' : ''}`}>
      <td className="l first" style={{ paddingLeft: 8 + (x.depth || 0) * 16 }}>{x.name}</td>
      <TA p={x.wk} x={x} unit={unit} />
      <TA p={x.mtd} x={asCount(x)} unit={unit} />
      {ytd && <TA p={x.ytd} x={asCount(x)} unit={unit} />}
      {adj && <Num className="gap" v={x.adj} fmt={x.fmt} unit={unit} />}
      {recon && <>
        <Num className="gap lock" v={x.prev} fmt={x.fmt} unit={unit} />
        <Num className="lock" v={x.this} fmt={x.fmt} unit={unit} />
        <Num className={x.diff ? 'diff' : ''} v={x.diff || null} fmt={x.fmt} unit={unit} />
      </>}
    </tr>
  );
}

export default function Weekly() {
  const { view, setView } = useApp();
  const [ytd, setYtd] = useState(true);
  const [recon, setRecon] = useState(true);
  const [full, setFull] = useState(false);
  const { data, err } = useView('/view/week', { node: view.nodeId, week: view.week, month: view.month || '' }, [view.nodeId, view.week, view.month]);
  const unit = view.unit;
  const hasAdj = !!data && data.sections.some((s) => s.rows.some((x) => x.adj));
  const cols = 1 + 8 + (ytd ? 4 : 0) + (hasAdj ? 1 : 0) + (recon ? 3 : 0);

  const exportCsv = () => {
    const out = [['Unit', 'Line', 'Week target', 'Week actual', 'MTD target', 'MTD actual', 'YTD target', 'YTD actual', 'Adj', 'Reported MTD', 'This week', 'Diff']];
    const push = (unitName, x) => out.push([unitName, x.name, x.wk?.t, x.wk?.a, x.mtd?.t, x.mtd?.a, x.ytd?.t, x.ytd?.a, x.adj, x.prev, x.this, x.diff]);
    for (const s of data.sections) for (const x of s.rows) if (!x.group) push(data.node.name, x);
    for (const c of data.children || []) for (const s of data.sections) for (const x of s.rows) if (x.code && c.rows[x.code]) push(c.name, { ...x, ...c.rows[x.code] });
    download(`JW-weekly-${data.node.name}-${data.week.key}.csv`, toCSV(out));
  };

  const segs = data?.week.segments || [];
  const allRows = data ? data.sections.flatMap((s) => s.rows).filter((x) => x.code) : [];
  const childLabel = data?.children?.[0]?.type === 'company' ? 'company' : 'cluster';

  return (
    <>
      <div className="bar">
        <NodeSelect value={view.nodeId} onChange={(id) => setView({ nodeId: id })} />
        <WeekSelect value={view.week} onChange={(w) => setView({ week: w, month: null })} />
        {segs.length > 1 && <Seg value={data.month} options={segs.map((s) => [s.month, `MTD ${s.label}`])} onChange={(m) => setView({ month: m })} />}
        <UnitSelect />
        <label className="c"><input type="checkbox" checked={ytd} onChange={(e) => setYtd(e.target.checked)} />YTD</label>
        <label className="c"><input type="checkbox" checked={recon} onChange={(e) => setRecon(e.target.checked)} />Reconciliation</label>
        <span className="sp" />
        {data && <button onClick={exportCsv}>Export</button>}
        <PrintButton />
      </div>
      {err && <div className="note err">{err}</div>}
      {!data ? <Loading /> : (
        <>
          <PrintHeader node={data.node} title="Weekly report" period={`${data.week.label} · MTD ${data.month_label} · ${UNITS[unit].label}`} />
          <Crumbs path={data.path} onPick={(id) => setView({ nodeId: id })} />
          <div className="title">
            <Logo node={data.node} />
            <h1>{data.node.name}</h1>
            <span className="meta">{data.week.label} · {UNITS[unit].label}</span>
            <span className="sp" />
            {data.node.type === 'company' ? <St s={data.coverage.status[0]?.status} reopened={data.coverage.status[0]?.reopened} /> : <StatusCounts by={data.coverage.by} />}
          </div>
          {segs.length > 1 && <div className="small mute" style={{ marginBottom: 8 }}>{segs.map((s) => `${s.label} → ${s.month}${s.closes_month ? ' (month end)' : ''}`).join('   ·   ')}</div>}

          {data.children && <h2 className="part">{data.node.type === 'group' ? 'Group summary' : 'Cluster summary'}</h2>}
          <div className="wrap">
            <table className="r">
              <Head data={data} ytd={ytd} recon={recon} adj={hasAdj} />
              <tbody>
                {data.sections.map((s) => (
                  <Fragment key={s.code}>
                    <tr className="sec"><td colSpan={cols} className="first">{s.name}</td></tr>
                    {s.rows.filter((x) => !emptyWeekRow(x)).map((x, i) => (x.group
                      ? <tr key={`g${i}`} className="grp"><td colSpan={cols} className="l first">{x.name}</td></tr>
                      : <Row key={x.code} x={x} unit={unit} ytd={ytd} recon={recon} adj={hasAdj} />))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          {data.adjustments.length > 0 && (
            <div style={{ marginTop: 18 }}>
              <h3 style={{ fontWeight: 'bold', marginBottom: 4 }}>Prior-week adjustments</h3>
              <div className="wrap"><table className="r" style={{ maxWidth: 1000 }}>
                <thead><tr><th className="l">Company</th><th className="l">Line</th><th>Amount</th><th className="l">Reason</th></tr></thead>
                <tbody>{data.adjustments.map((a, i) => (
                  <tr key={i}><td className="l">{a.company}</td><td className="l">{a.label}</td><Num v={a.value} fmt={/:(PQ|SQ)$/.test(a.item) ? 'qty' : 'amount'} unit={unit} /><td className="l">{a.reason}</td></tr>
                ))}</tbody>
              </table></div>
            </div>
          )}

          {data.children?.length > 0 && (
            <>
              <div className="row" style={{ marginTop: 10 }}>
                <h2 className="part" style={{ flex: 1 }}>By {childLabel}</h2>
                <Seg value={full ? 'f' : 'k'} options={[['k', 'Key lines'], ['f', 'Full pack']]} onChange={(v) => setFull(v === 'f')} />
              </div>
              {data.children.map((c) => (
                <div className="unit" key={c.id}>
                  <div className="uh" onClick={() => setView({ nodeId: c.id })}>
                    <Logo node={c} size="sm" /><h3>{c.name}</h3>
                    <span className="sp" />
                    {c.type === 'company' ? <St s={c.status} reopened={c.reopened} /> : <StatusCounts by={c.coverage.by} />}
                    <span className="small">open ›</span>
                  </div>
                  <div className="wrap">
                    <table className="r">
                      <Head data={data} ytd={ytd} recon={false} adj={hasAdj} />
                      <tbody>
                        {(full ? allRows : KEY_WEEK.map((k) => allRows.find((x) => x.code === k)).filter(Boolean)).map((x) => (
                          c.rows[x.code] ? <Row key={x.code} x={{ ...x, ...c.rows[x.code], name: x.name, depth: full ? x.depth : 0 }} unit={unit} ytd={ytd} recon={false} adj={hasAdj} flag={false} /> : null
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </>
          )}
          {data.node.type !== 'company' && data.coverage.status.some((s) => !['approved', 'cluster_ok', 'company_ok', 'submitted', 'na'].includes(s.status)) && (
            <div className="small mute" style={{ marginTop: 14 }}>
              {data.coverage.status.filter((s) => !['approved', 'cluster_ok', 'company_ok', 'submitted', 'na'].includes(s.status)).map((s) => `${s.name}: ${STATUS[s.status]}`).join(' · ')}
            </div>
          )}
        </>
      )}
    </>
  );
}
