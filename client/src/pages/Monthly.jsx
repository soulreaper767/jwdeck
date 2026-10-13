import { Fragment, useEffect, useState } from 'react';
import { useApp } from '../store.jsx';
import { api, qs } from '../lib/api.js';
import { fv, vr, fpct, toCSV, download, UNITS } from '../lib/format.js';
import { NodeSelect, MonthSelect, UnitSelect, Loading, Num } from '../ui.jsx';

export default function Monthly() {
  const { view, setView, periods } = useApp();
  const month = view.month && /^\d{4}-\d{2}$/.test(view.month) ? view.month : periods?.current_month;
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const unit = view.unit;

  useEffect(() => {
    if (!view.nodeId || !month) return undefined;
    let live = true;
    setErr('');
    api.get(`/view/month${qs({ node: view.nodeId, month })}`).then((r) => live && setData(r)).catch((e) => live && setErr(e.message));
    return () => { live = false; };
  }, [view.nodeId, month]);

  const exportCsv = () => {
    const out = [['Line', ...data.columns.map((c) => `${c.week} ${c.label}`), 'Adj', 'Month', 'Budget', 'Budget to date', 'YTD', 'YTD budget']];
    for (const s of data.sections) { out.push([s.name]); for (const x of s.rows) if (!x.group) out.push([x.name, ...x.cols, x.adj, x.total, x.budget, x.btd, x.ytd, x.ytdB]); }
    download(`JW-monthly-${data.node.name}-${data.month}.csv`, toCSV(out));
  };

  const ncols = data ? 1 + data.columns.length + 1 + 5 + 3 : 1;
  return (
    <>
      <div className="bar">
        <NodeSelect value={view.nodeId} onChange={(id) => setView({ nodeId: id })} />
        <MonthSelect value={month} onChange={(m) => setView({ month: m })} />
        <UnitSelect />
        <span className="sp" />
        {data && <button onClick={exportCsv}>Export</button>}
      </div>
      {err && <div className="note err">{err}</div>}
      {!data ? <Loading /> : (
        <>
          <div className="title"><h1>{data.node.name}</h1><span className="meta">{data.month_label} · {data.fy_label} · {UNITS[unit].label}</span></div>
          <div className="wrap" style={{ marginTop: 10 }}>
            <table className="r">
              <thead>
                <tr className="g">
                  <th className="l" />
                  <th colSpan={data.columns.length} className="gap">Weeks</th>
                  <th className="gap" />
                  <th colSpan={5} className="gap">{data.month_label}</th>
                  <th colSpan={3} className="gap">YTD · {data.fy_label}</th>
                </tr>
                <tr>
                  <th className="l" style={{ minWidth: 240 }} />
                  {data.columns.map((c, i) => <th key={c.week} className={i === 0 ? 'gap' : ''}>{c.week.slice(5)}<br /><span className="mute">{c.label}</span></th>)}
                  <th className="gap">Adj.</th>
                  <th className="gap">Actual</th><th>Budget</th><th>To date</th><th>Var</th><th>%</th>
                  <th className="gap">Actual</th><th>Budget</th><th>%</th>
                </tr>
              </thead>
              <tbody>
                {data.sections.map((s) => (
                  <Fragment key={s.code}>
                    <tr className="sec"><td colSpan={ncols}>{s.name}</td></tr>
                    {s.rows.map((x, i) => {
                      if (x.group) return <tr key={`g${i}`} className="grp"><td colSpan={ncols} className="l" style={{ paddingLeft: 8 }}>{x.name}</td></tr>;
                      const op = x.nature === 'opening';
                      const v = vr(x.total, x.btd, x.hib, x.fmt);
                      const y = vr(x.ytd, x.ytdB, x.hib, x.fmt);
                      return (
                        <tr key={x.code} className={x.strong ? 'tot' : ''}>
                          <td className="l" style={{ paddingLeft: 8 + x.depth * 16 }}>{x.name}</td>
                          {x.cols.map((c, j) => <Num key={j} className={j === 0 ? 'gap' : ''} v={c} fmt={x.fmt} unit={unit} />)}
                          <Num className="gap" v={x.adj} fmt={x.fmt} unit={unit} />
                          <Num className="gap" v={x.total} fmt={x.fmt} unit={unit} />
                          <Num className="lock" v={op ? null : x.budget} fmt={x.fmt} unit={unit} />
                          <Num className="lock" v={op ? null : x.btd} fmt={x.fmt} unit={unit} />
                          <Num className={v.cls} v={op ? null : v.d} fmt={x.fmt} unit={unit} />
                          <td className={`n ${v.cls}`}>{op ? '' : fpct(v.pct)}</td>
                          <Num className="gap" v={x.ytd} fmt={x.fmt} unit={unit} />
                          <Num className="lock" v={op ? null : x.ytdB} fmt={x.fmt} unit={unit} />
                          <td className={`n ${y.cls}`}>{op ? '' : fpct(y.pct)}</td>
                        </tr>
                      );
                    })}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
