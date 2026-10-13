import { Fragment, useEffect, useState } from 'react';
import { useApp } from '../store.jsx';
import { api, qs } from '../lib/api.js';
import { fv, vr, fpct, toCSV, download, UNITS } from '../lib/format.js';
import { NodeSelect, WeekSelect, UnitSelect, Seg, Loading, Num } from '../ui.jsx';

export function useWeek(nodeId, week, month) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!nodeId || !week) return undefined;
    let live = true;
    setErr('');
    api.get(`/view/week${qs({ node: nodeId, week, month })}`).then((r) => live && setData(r)).catch((e) => live && setErr(e.message));
    return () => { live = false; };
  }, [nodeId, week, month]);
  return { data, err };
}

function TA({ p, x, unit }) {
  const opening = x.nature === 'opening';
  const v = vr(p.a, p.t, x.hib, x.fmt);
  return (
    <>
      <Num className="gap lock" v={opening ? null : p.t} fmt={x.fmt} unit={unit} />
      <Num v={p.a} fmt={x.fmt} unit={unit} />
      <Num className={v.cls} v={opening ? null : v.d} fmt={x.fmt} unit={unit} />
      <td className={`n ${v.cls}`}>{opening ? '' : fpct(v.pct)}</td>
    </>
  );
}

export default function Weekly() {
  const { view, setView, nodes } = useApp();
  const [ytd, setYtd] = useState(true);
  const [recon, setRecon] = useState(true);
  const [open, setOpen] = useState(() => new Set());
  const { data, err } = useWeek(view.nodeId, view.week, view.month);
  const unit = view.unit;

  const toggle = (code) => setOpen((s) => { const n = new Set(s); n.has(code) ? n.delete(code) : n.add(code); return n; });
  const cols = 1 + 4 + 4 + (ytd ? 4 : 0) + 1 + (recon ? 3 : 0);

  const exportCsv = () => {
    const out = [['Line', 'Week target', 'Week actual', 'MTD target', 'MTD actual', 'YTD target', 'YTD actual', 'Prior-week adj', 'Prev. reported MTD', 'This week', 'Difference']];
    for (const s of data.sections) {
      out.push([s.name]);
      for (const x of s.rows) if (!x.group) out.push([x.name, x.wk.t, x.wk.a, x.mtd.t, x.mtd.a, x.ytd.t, x.ytd.a, x.adj, x.prev, x.this, x.diff]);
    }
    download(`JW-weekly-${data.node.name}-${data.week.key}.csv`, toCSV(out));
  };

  const segs = data?.week.segments || [];
  return (
    <>
      <div className="bar">
        <NodeSelect value={view.nodeId} onChange={(id) => setView({ nodeId: id })} />
        <WeekSelect value={view.week} onChange={(w) => setView({ week: w, month: null })} />
        {segs.length > 1 && (
          <Seg value={data.month} options={segs.map((s) => [s.month, `MTD ${s.label}`])} onChange={(m) => setView({ month: m })} />
        )}
        <UnitSelect />
        <label className="c"><input type="checkbox" checked={ytd} onChange={(e) => setYtd(e.target.checked)} />YTD</label>
        <label className="c"><input type="checkbox" checked={recon} onChange={(e) => setRecon(e.target.checked)} />Reconciliation</label>
        <span className="sp" />
        {data && <button onClick={exportCsv}>Export</button>}
      </div>
      {err && <div className="note err">{err}</div>}
      {!data ? <Loading /> : (
        <>
          <div className="title">
            <h1>{data.node.name}</h1>
            <span className="meta">{data.week.label} · MTD {data.month_label} · {data.fy_label} · {UNITS[unit].label}</span>
            <span className="sp" />
            <span className={data.coverage.filed < data.coverage.started ? 'bad' : 'mute'}>Filed {data.coverage.filed}/{data.coverage.started}</span>
          </div>
          {segs.length > 1 && (
            <div className="mute small" style={{ marginBottom: 10 }}>
              {segs.map((s) => `${s.label} → ${s.month}${s.closes_month ? ' (month end)' : ''}`).join('   ·   ')}
            </div>
          )}
          <div className="wrap">
            <table className="r">
              <thead>
                <tr className="g">
                  <th className="l" />
                  <th colSpan={4} className="gap">Week · {data.week.label.split(' · ')[1]}</th>
                  <th colSpan={4} className="gap">MTD · {data.month_label}</th>
                  {ytd && <th colSpan={4} className="gap">YTD · {data.fy_label}</th>}
                  <th className="gap">Prior wk</th>
                  {recon && <th colSpan={3} className="gap">MTD reconciliation</th>}
                </tr>
                <tr>
                  <th className="l" style={{ minWidth: 250 }} />
                  {['', ...(ytd ? [''] : [])].concat('').map((_, i) => (
                    <Fragment key={i}><th className="gap">Target</th><th>Actual</th><th>Var</th><th>%</th></Fragment>
                  ))}
                  <th className="gap">Adj.</th>
                  {recon && <><th className="gap">Reported</th><th>+ This wk</th><th>Diff</th></>}
                </tr>
              </thead>
              <tbody>
                {data.sections.map((s) => (
                  <Fragment key={s.code}>
                    <tr className="sec"><td colSpan={cols}>{s.name}</td></tr>
                    {s.rows.map((x, i) => {
                      if (x.group) return <tr key={`g${i}`} className="grp"><td colSpan={cols} className="l" style={{ paddingLeft: 8 }}>{x.name}</td></tr>;
                      const kids = data.children && !x.code.startsWith('UNIT:') && x.fmt !== 'qty';
                      const isOpen = open.has(x.code);
                      return (
                        <Fragment key={x.code}>
                          <tr className={`${x.strong ? 'tot' : ''} ${kids ? 'click' : ''} ${x.diff ? 'flag' : ''}`} onClick={() => kids && toggle(x.code)}>
                            <td className="l" style={{ paddingLeft: 8 + x.depth * 16 }}>{x.name}{kids && <span className="mute small"> {isOpen ? '−' : '+'}</span>}</td>
                            <TA p={x.wk} x={x} unit={unit} />
                            <TA p={x.mtd} x={x} unit={unit} />
                            {ytd && <TA p={x.ytd} x={x} unit={unit} />}
                            <Num className="gap" v={x.adj} fmt={x.fmt} unit={unit} />
                            {recon && <>
                              <Num className="gap lock" v={x.prev} fmt={x.fmt} unit={unit} />
                              <Num className="lock" v={x.this} fmt={x.fmt} unit={unit} />
                              <Num className={x.diff ? 'diff' : ''} v={x.diff || null} fmt={x.fmt} unit={unit} />
                            </>}
                          </tr>
                          {isOpen && data.children.map((c) => {
                            const cx = c.rows[x.code];
                            if (!cx) return null;
                            return (
                              <tr key={c.id} className="kid click" onClick={() => setView({ nodeId: c.id })}>
                                <td className="l" style={{ paddingLeft: 24 + x.depth * 16 }}>{c.name}{c.coverage.filed < c.coverage.started ? ' *' : ''}</td>
                                <TA p={cx.wk} x={x} unit={unit} />
                                <TA p={cx.mtd} x={x} unit={unit} />
                                {ytd && <TA p={cx.ytd} x={x} unit={unit} />}
                                <Num className="gap" v={cx.adj} fmt={x.fmt} unit={unit} />
                                {recon && <td colSpan={3} className="gap" />}
                              </tr>
                            );
                          })}
                        </Fragment>
                      );
                    })}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          {data.adjustments.length > 0 && (
            <div style={{ marginTop: 26 }}>
              <h2 style={{ marginBottom: 6 }}>Prior-week adjustments in this report</h2>
              <table className="r" style={{ maxWidth: 900 }}>
                <thead><tr><th className="l">Company</th><th className="l">Line</th><th>Amount</th><th className="l">Reason</th></tr></thead>
                <tbody>{data.adjustments.map((a, i) => (
                  <tr key={i}><td className="l">{a.company}</td><td className="l">{a.label}</td><td className="n">{fv(a.value, a.item.endsWith(':PQ') || a.item.endsWith(':SQ') ? 'qty' : 'amount', unit)}</td><td className="l">{a.reason}</td></tr>
                ))}</tbody>
              </table>
            </div>
          )}
          {data.coverage.filed < data.coverage.started && (
            <div className="small mute" style={{ marginTop: 14 }}>
              Not filed: {data.coverage.status.filter((s) => s.started && !s.filed).map((s) => s.name).join(', ')}
            </div>
          )}
          {nodes.get(view.nodeId)?.parent && (
            <div style={{ marginTop: 14 }}><button className="link" onClick={() => setView({ nodeId: nodes.get(view.nodeId).parent.id })}>↑ {nodes.get(view.nodeId).parent.name}</button></div>
          )}
        </>
      )}
    </>
  );
}
