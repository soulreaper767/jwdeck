import { Fragment, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../store.jsx';
import { api, qs } from '../lib/api.js';
import { fmtVal, variance, toCSV, download } from '../lib/format.js';
import ViewBar from '../components/ViewBar.jsx';
import { Seg, Spinner } from '../components/ui.jsx';
import { useReport, Crumbs, Coverage } from './Dashboard.jsx';

function Delta({ cur, base, h }) {
  const v = variance(cur, base, h.higher_is_better, h.fmt);
  return <span className={`delta ${v.cls}`}>{v.text}</span>;
}

export default function Report() {
  const { view, setView } = useApp();
  const { data, err } = useReport();
  const [layout, setLayout] = useState('cmp');
  const [stmt, setStmt] = useState('ALL');
  const [open, setOpen] = useState(() => new Set()); // head ids showing unit breakdown
  const [collapsed, setCollapsed] = useState(() => new Set()); // head ids whose sub-heads are hidden
  const [lines, setLines] = useState({}); // `${headId}|${companyId}` -> native lines

  const visible = useMemo(() => {
    if (!data) return [];
    const byId = new Map(data.heads.map((h) => [h.id, h]));
    return data.heads.filter((h) => {
      if (stmt !== 'ALL' && h.statement !== stmt && !(stmt === 'PL' && h.statement === 'PL')) return false;
      for (let p = byId.get(h.parent_id); p; p = byId.get(p.parent_id)) if (collapsed.has(p.id)) return false;
      return true;
    });
  }, [data, stmt, collapsed]);

  if (err) return <><div className="topbar"><ViewBar /></div><div className="content"><div className="alert err">{err}</div></div></>;
  if (!data) return <><div className="topbar"><ViewBar /></div><Spinner /></>;

  const s = view.scale;
  const hasKids = new Set(data.heads.filter((h) => h.parent_id).map((h) => h.parent_id));
  const toggle = (set, setter, id) => { const n = new Set(set); n.has(id) ? n.delete(id) : n.add(id); setter(n); };

  const loadLines = async (head, company) => {
    const k = `${head.id}|${company.id}`;
    if (lines[k]) { setLines(({ [k]: _, ...rest }) => rest); return; }
    const r = await api.get(`/consol/company${qs({ company: company.id, freq: data.frequency, key: data.key, mode: data.mode, head: head.id })}`);
    setLines((x) => ({ ...x, [k]: r }));
  };

  const exportCsv = () => {
    const rows = [];
    if (layout === 'cmp') {
      rows.push(['Code', 'Head', data.labels.cur, data.labels.prev || '', data.labels.ly]);
      visible.forEach((h) => rows.push([h.code, `${'  '.repeat(h.depth)}${h.name}`, data.cur[h.id], data.prev?.[h.id] ?? '', data.ly[h.id]]));
    } else {
      rows.push(['Code', 'Head', ...data.children.map((c) => c.name), data.node.name]);
      visible.forEach((h) => rows.push([h.code, h.name, ...data.children.map((c) => data.by_child[c.id]?.cur?.[h.id] ?? ''), data.cur[h.id]]));
    }
    download(`JW-${data.node.code}-${data.key}-${data.mode}.csv`, toCSV(rows));
  };

  const childType = data.children[0]?.type === 'company' ? 'company' : 'unit';

  return (
    <>
      <div className="topbar"><ViewBar /></div>
      <div className="content stack">
        <div className="page-head">
          <div>
            <Crumbs path={data.path} onPick={(id) => setView({ nodeId: id })} />
            <h1 style={{ marginTop: 4 }}>Consolidated statement · {data.node.name}</h1>
            <div className="sub">{data.labels.cur} · {data.group_currency} {s !== 'auto' && s !== '1' ? `(${s === 'K' ? "'000" : s === 'M' ? 'millions' : 'billions'})` : ''} · click a head to see which {childType === 'company' ? 'companies' : 'units'} it comes from</div>
          </div>
          <div className="spacer" />
          <Seg value={stmt} options={[['ALL', 'All'], ['PL', 'P&L'], ['CF', 'Cash'], ['BS', 'Position'], ['KPI', 'KPIs']]} onChange={setStmt} />
          <Seg value={layout} options={[['cmp', 'Comparatives'], ['children', `By ${childType}`]]} onChange={setLayout} />
          <button onClick={exportCsv}>Export CSV</button>
        </div>
        <Coverage cov={data.coverage.cur} label={data.labels.cur} lfl={data.lfl} />

        <div className="card">
          <div className="card-b flush tablewrap">
            <table className="t">
              <thead>
                {layout === 'cmp' ? (
                  <tr>
                    <th style={{ minWidth: 280 }}>Head</th>
                    <th className="num">{data.labels.cur}</th>
                    {data.prev && <><th className="num locked">{data.labels.prev}</th><th className="num">Δ prev</th></>}
                    <th className="num locked">{data.labels.ly}</th><th className="num">Δ LY</th>
                  </tr>
                ) : (
                  <tr>
                    <th style={{ minWidth: 260 }}>Head</th>
                    {data.children.map((c) => (
                      <th key={c.id} className="num">
                        {c.type === 'company' ? <Link to={`/company/${c.id}`}>{c.name}</Link>
                          : <a href="#" onClick={(e) => { e.preventDefault(); setView({ nodeId: c.id }); }}>{c.name}</a>}
                      </th>
                    ))}
                    <th className="num">Total</th>
                  </tr>
                )}
              </thead>
              <tbody>
                {visible.map((h) => {
                  if (h.head_type === 'section') {
                    return (
                      <tr key={h.id} className="sec click" onClick={() => toggle(collapsed, setCollapsed, h.id)}>
                        <td colSpan={layout === 'cmp' ? 6 : data.children.length + 2}>
                          <span className="caret">{collapsed.has(h.id) ? '▸' : '▾'}</span>{h.name}
                        </td>
                      </tr>
                    );
                  }
                  const bold = h.head_type !== 'input' || h.depth === 0;
                  const isOpen = open.has(h.id);
                  return (
                    <Fragment key={h.id}>
                      <tr className={`click ${bold ? 'b' : ''}`} onClick={() => layout === 'cmp' && toggle(open, setOpen, h.id)}>
                        <td className="lbl" style={{ paddingLeft: 12 + h.depth * 18 }}>
                          {hasKids.has(h.id) ? (
                            <span className="caret" onClick={(e) => { e.stopPropagation(); toggle(collapsed, setCollapsed, h.id); }}>
                              {collapsed.has(h.id) ? '⊞' : '⊟'}
                            </span>
                          ) : <span className="caret" />}
                          {h.name}
                          {layout === 'cmp' && <span className="faint small" style={{ marginLeft: 6 }}>{isOpen ? '▴' : '▾'}</span>}
                        </td>
                        {layout === 'cmp' ? (
                          <>
                            <td className="num">{fmtVal(data.cur[h.id], h.fmt, s)}</td>
                            {data.prev && <><td className="num locked">{fmtVal(data.prev[h.id], h.fmt, s)}</td>
                              <td className="num"><Delta cur={data.cur[h.id]} base={data.prev[h.id]} h={h} /></td></>}
                            <td className="num locked">{fmtVal(data.ly[h.id], h.fmt, s)}</td>
                            <td className="num"><Delta cur={data.cur[h.id]} base={data.ly[h.id]} h={h} /></td>
                          </>
                        ) : (
                          <>
                            {data.children.map((c) => <td key={c.id} className="num">{fmtVal(data.by_child[c.id]?.cur?.[h.id], h.fmt, s)}</td>)}
                            <td className="num" style={{ fontWeight: 650 }}>{fmtVal(data.cur[h.id], h.fmt, s)}</td>
                          </>
                        )}
                      </tr>
                      {layout === 'cmp' && isOpen && data.children.map((c) => {
                        const bc = data.by_child[c.id];
                        const k = `${h.id}|${c.id}`;
                        const nl = lines[k];
                        const share = h.fmt === 'amount' && data.cur[h.id] ? ((bc?.cur?.[h.id] ?? 0) / data.cur[h.id]) * 100 : null;
                        return (
                          <Fragment key={c.id}>
                            <tr className="child">
                              <td className="lbl" style={{ paddingLeft: 30 + h.depth * 18 }}>
                                <span className={`ico ${c.type}`} style={{ display: 'inline-grid', width: 16, height: 16, fontSize: 9, borderRadius: 3, marginRight: 6, placeItems: 'center', fontWeight: 700 }}>{c.type === 'company' ? 'Co' : 'C'}</span>
                                {c.type === 'company' ? (
                                  <a href="#" onClick={(e) => { e.preventDefault(); loadLines(h, c); }}>{c.name} {nl ? '▴' : '▾'}</a>
                                ) : (
                                  <a href="#" onClick={(e) => { e.preventDefault(); setView({ nodeId: c.id }); }}>{c.name} →</a>
                                )}
                                {share != null && bc?.cur?.[h.id] != null && <span className="faint small" style={{ marginLeft: 8 }}>{share.toFixed(1)}%</span>}
                                {bc && bc.coverage.filed < bc.coverage.expected && <span className="badge draft" style={{ marginLeft: 8 }}>{bc.coverage.filed}/{bc.coverage.expected} filed</span>}
                              </td>
                              <td className="num">{fmtVal(bc?.cur?.[h.id], h.fmt, s)}</td>
                              {data.prev && <><td className="num locked">{fmtVal(bc?.prev?.[h.id], h.fmt, s)}</td>
                                <td className="num"><Delta cur={bc?.cur?.[h.id]} base={bc?.prev?.[h.id]} h={h} /></td></>}
                              <td className="num locked">{fmtVal(bc?.ly?.[h.id], h.fmt, s)}</td>
                              <td className="num"><Delta cur={bc?.cur?.[h.id]} base={bc?.ly?.[h.id]} h={h} /></td>
                            </tr>
                            {nl && (
                              nl.lines.filter((l) => l.highlight).length ? nl.lines.filter((l) => l.highlight).map((l) => (
                                <tr key={l.id} className="child2">
                                  <td className="lbl" style={{ paddingLeft: 56 + h.depth * 18 }}>
                                    <span className="tag grey" style={{ marginRight: 6 }}>{l.code}</span>{l.label}
                                    {l.sign === -1 && <span className="faint small"> (×−1)</span>}
                                    {h.head_type !== 'input' && <span className="tag" style={{ marginLeft: 6 }}>{l.head_code}</span>}
                                  </td>
                                  <td className="num">{fmtVal(nl.cur?.[l.id], h.fmt, s)}<span className="faint small"> {nl.company.currency !== data.group_currency ? nl.company.currency : ''}</span></td>
                                  {data.prev && <><td className="num locked">{fmtVal(nl.prev?.[l.id], h.fmt, s)}</td><td /></>}
                                  <td className="num locked">{fmtVal(nl.ly?.[l.id], h.fmt, s)}</td>
                                  <td className="num"><Link className="small" to={`/company/${c.id}?head=${h.id}`}>own format →</Link></td>
                                </tr>
                              )) : (
                                <tr className="child2"><td colSpan={6} style={{ paddingLeft: 56 + h.depth * 18 }} className="muted small">No line in this company's format feeds {h.name}.</td></tr>
                              )
                            )}
                          </Fragment>
                        );
                      })}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        <div className="muted small">
          Comparative columns (shaded) use locked figures as last filed. Unit drill-downs show each company's own line items in its own reporting
          currency; consolidated totals are translated to {data.group_currency}.
        </div>
      </div>
    </>
  );
}
