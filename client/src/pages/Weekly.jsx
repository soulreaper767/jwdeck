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

const asCount = (x) => (x.fmt === 'flag' ? { ...x, fmt: 'count' } : x);
export const emptyWeekRow = (x) => !x.group && [x.wk?.a, x.wk?.t, x.mtd?.a, x.mtd?.t, x.ytd?.a, x.ytd?.t, x.adj, x.pw?.a].every((v) => v == null || v === 0);
const COLS = 1 + 4 + 3 + 4 + 1;

// change vs another figure, coloured by whether higher is better
const chg = (a, b, hib = 1) => {
  if (a == null || b == null) return { d: null, pct: null, cls: '' };
  const d = a - b;
  const pct = b ? (d / Math.abs(b)) * 100 : null;
  return { d, pct, cls: Math.abs(d) < 1 ? '' : (hib ? d >= 0 : d <= 0) ? 'good' : 'bad' };
};

function Head({ data }) {
  return (
    <thead>
      <tr className="g">
        <th className="l first" />
        <th colSpan={4} className="gap">Week · {data.week.label.split(' · ')[1]}</th>
        <th colSpan={3} className="gap">Prior week · {data.prior_week.label.split(' · ')[1]}</th>
        <th colSpan={4} className="gap">MTD reconciliation · {data.month_label}</th>
        <th className="gap" />
      </tr>
      <tr>
        <th className="l first" style={{ minWidth: 220 }} />
        <th className="gap">Target</th><th>Actual</th><th>Var</th><th>%</th>
        <th className="gap">Actual</th><th>Change</th><th>%</th>
        <th className="gap" title="MTD as reported last week">Reported</th><th>+ This week</th><th title="Prior-week adjustments and re-filed weeks">Adjustment</th><th>= MTD</th>
        <th className="gap" />
      </tr>
    </thead>
  );
}

function NoteList({ notes, unit }) {
  return (
    <div className="notes">
      {notes.map((n, i) => (
        <div key={i}>
          <b>{n.company}</b> · {n.week.slice(5)} · {n.type === 'adjustment'
            ? <>{n.line} <span className="adjv">{fv(n.value, 'amount', unit) || '0'}</span>: {n.reason}</>
            : <>re-filed (revision {n.revision}){n.reason ? `: ${n.reason}` : ''}</>}
        </div>
      ))}
    </div>
  );
}

function Row({ x: x0, unit, open, toggle }) {
  const x = asCount(x0);
  const op = x.nature === 'opening';
  const v = vr(x.wk?.a, x.wk?.t, x.hib, x.fmt);
  const p = chg(x.wk?.a, x.pw?.a, x.hib);
  const recon = x.diff != null;
  const hasNotes = !!x.notes?.length;
  return (
    <>
      <tr className={`${x.grand ? 'grand' : x.strong ? 'tot' : ''} ${x.diff ? 'adjrow' : ''}`}>
        <td className="l first" style={{ paddingLeft: 8 + (x.depth || 0) * 16 }}>{x.name}</td>
        <Num className="gap lock" v={op ? null : x.wk?.t} fmt={x.fmt} unit={unit} />
        <Num v={x.wk?.a} fmt={x.fmt} unit={unit} />
        <Num className={v.cls} v={op ? null : v.d} fmt={x.fmt} unit={unit} />
        <td className={`n ${v.cls}`}>{op ? '' : fpct(v.pct)}</td>
        <Num className="gap lock" v={x.pw?.a} fmt={x.fmt} unit={unit} />
        <Num className={p.cls} v={op || x.fmt === 'percent' ? null : p.d} fmt={x.fmt} unit={unit} />
        <td className={`n ${p.cls}`}>{op || x.fmt === 'percent' ? '' : fpct(p.pct)}</td>
        {recon && !x.prev ? <td className="n gap lock zero">0</td> : <Num className="gap lock" v={recon ? x.prev : null} fmt={x.fmt} unit={unit} />}
        {recon && !x.this ? <td className="n zero">0</td> : <Num v={recon ? x.this : null} fmt={x.fmt} unit={unit} />}
        {recon ? (x.diff ? <Num className="adjv" v={x.diff} fmt={x.fmt} unit={unit} /> : <td className="n zero">0</td>) : <td />}
        <Num className="tot-c" v={x.mtd?.a} fmt={x.fmt} unit={unit} />
        <td className="gap c">{hasNotes && <button className={`why ${open ? 'on' : ''}`} onClick={toggle}>why</button>}</td>
      </tr>
      {open && hasNotes && <tr className="note-row"><td colSpan={COLS} className="first"><NoteList notes={x.notes} unit={unit} /></td></tr>}
    </>
  );
}

// compact block for each cluster / company
function UnitHead({ data }) {
  return (
    <thead>
      <tr className="g"><th className="l first" /><th colSpan={3} className="gap">Week</th><th colSpan={2} className="gap">Prior week</th><th colSpan={2} className="gap">MTD · {data.month_label}</th></tr>
      <tr><th className="l first" style={{ minWidth: 220 }} /><th className="gap">Target</th><th>Actual</th><th>%</th><th className="gap">Actual</th><th>Change</th><th className="gap">Actual</th><th>Adjustment</th></tr>
    </thead>
  );
}
function UnitRow({ x: x0, unit }) {
  const x = asCount(x0);
  const op = x.nature === 'opening';
  const v = vr(x.wk?.a, x.wk?.t, x.hib, x.fmt);
  const p = chg(x.wk?.a, x.pw?.a, x.hib);
  return (
    <tr className={x.grand ? 'grand' : x.strong ? 'tot' : ''}>
      <td className="l first" style={{ paddingLeft: 8 + (x.depth || 0) * 16 }}>{x.name}</td>
      <Num className="gap lock" v={op ? null : x.wk?.t} fmt={x.fmt} unit={unit} />
      <Num v={x.wk?.a} fmt={x.fmt} unit={unit} />
      <td className={`n ${v.cls}`}>{op ? '' : fpct(v.pct)}</td>
      <Num className="gap lock" v={x.pw?.a} fmt={x.fmt} unit={unit} />
      <td className={`n ${p.cls}`}>{op ? '' : fpct(p.pct)}</td>
      <Num className="gap" v={x.mtd?.a} fmt={x.fmt} unit={unit} />
      {x.diff == null ? <td /> : x.diff ? <Num className="adjv" v={x.diff} fmt={x.fmt} unit={unit} /> : <td className="n zero">0</td>}
    </tr>
  );
}

export default function Weekly() {
  const { view, setView } = useApp();
  const [full, setFull] = useState(false);
  const [openRows, setOpenRows] = useState(() => new Set());
  const [allOpen, setAllOpen] = useState(false);
  const { data, err } = useView('/view/week', { node: view.nodeId, week: view.week, month: view.month || '' }, [view.nodeId, view.week, view.month]);
  const unit = view.unit;
  useEffect(() => { setOpenRows(new Set()); setAllOpen(false); }, [view.nodeId, view.week, view.month]);

  const segs = data?.week.segments || [];
  const allRows = data ? data.sections.flatMap((s) => s.rows).filter((x) => x.code) : [];
  const changed = allRows.filter((x) => x.diff);
  const noted = allRows.filter((x) => x.notes?.length);
  const childLabel = data?.children?.[0]?.type === 'company' ? 'company' : 'cluster';
  const toggle = (code) => setOpenRows((o) => { const n = new Set(o); n.has(code) ? n.delete(code) : n.add(code); return n; });

  const exportCsv = () => {
    const out = [['Unit', 'Line', 'Week target', 'Week actual', 'Prior week', 'MTD reported last week', 'This week', 'Adjustment', 'MTD', 'Explanation']];
    const push = (unitName, x) => out.push([unitName, x.name, x.wk?.t, x.wk?.a, x.pw?.a, x.prev, x.this, x.diff, x.mtd?.a,
      (x.notes || []).map((n) => `${n.company} ${n.week}: ${n.type === 'adjustment' ? `${n.line} ${n.value} – ${n.reason}` : `re-filed rev ${n.revision} – ${n.reason}`}`).join(' | ')]);
    for (const s of data.sections) for (const x of s.rows) if (!x.group) push(data.node.name, x);
    for (const c of data.children || []) for (const x of allRows) if (c.rows[x.code]) push(c.name, { ...x, ...c.rows[x.code] });
    download(`JW-weekly-${data.node.name}-${data.week.key}.csv`, toCSV(out));
  };

  return (
    <>
      <div className="bar">
        <NodeSelect value={view.nodeId} onChange={(id) => setView({ nodeId: id })} />
        <WeekSelect value={view.week} onChange={(w) => setView({ week: w, month: null })} />
        {segs.length > 1 && <Seg value={data.month} options={segs.map((s) => [s.month, `MTD ${s.label}`])} onChange={(m) => setView({ month: m })} />}
        <UnitSelect />
        {data && <button className={allOpen ? 'dark' : ''} onClick={() => setAllOpen(!allOpen)} disabled={!noted.length}>{allOpen ? 'Hide comments' : `Show comments (${noted.length})`}</button>}
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
            <span className="meta">{data.week.label} · vs prior week {data.prior_week.label.split(' · ')[0]} · {UNITS[unit].label}</span>
            <span className="sp" />
            {data.node.type === 'company' ? <St s={data.coverage.status[0]?.status} reopened={data.coverage.status[0]?.reopened} /> : <StatusCounts by={data.coverage.by} />}
          </div>
          <div className="rv-tiles">
            <div className={`rv-t ${data.adjustments.length ? 'warn' : 'ok'}`} onClick={() => noted.length && setAllOpen(true)} style={{ cursor: noted.length ? 'pointer' : 'default' }}><span>Prior-week adjustments</span><b>{data.adjustments.length}</b></div>
            <div className={`rv-t ${data.revisions.length ? 'warn' : 'ok'}`} onClick={() => noted.length && setAllOpen(true)} style={{ cursor: noted.length ? 'pointer' : 'default' }}><span>Re-filed weeks</span><b>{data.revisions.length}</b></div>
            <div className={`rv-t ${changed.length ? 'warn' : 'ok'}`}><span>Lines with MTD adjustment</span><b>{changed.length}</b></div>
          </div>
          {segs.length > 1 && <div className="small mute" style={{ marginBottom: 8 }}>{segs.map((s) => `${s.label} → ${s.month}${s.closes_month ? ' (month end)' : ''}`).join('   ·   ')}</div>}

          {data.children && <h2 className="part">{data.node.type === 'group' ? 'Group summary' : 'Cluster summary'}</h2>}
          <div className="wrap">
            <table className="r">
              <Head data={data} />
              <tbody>
                {data.sections.map((s) => (
                  <Fragment key={s.code}>
                    <tr className="sec"><td colSpan={COLS} className="first">{s.name}</td></tr>
                    {s.rows.filter((x) => !emptyWeekRow(x)).map((x, i) => (x.group
                      ? <tr key={`g${i}`} className="grp"><td colSpan={COLS} className="l first">{x.name}</td></tr>
                      : <Row key={x.code} x={x} unit={unit} open={allOpen || openRows.has(x.code)} toggle={() => toggle(x.code)} />))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

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
                      <UnitHead data={data} />
                      <tbody>
                        {(full ? allRows : KEY_WEEK.map((k) => allRows.find((x) => x.code === k)).filter(Boolean)).map((x) => (
                          c.rows[x.code] ? <UnitRow key={x.code} x={{ ...x, ...c.rows[x.code], name: x.name, depth: full ? x.depth : 0 }} unit={unit} /> : null
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
