import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useApp } from '../store.jsx';
import { api, qs } from '../lib/api.js';
import { fmtVal, variance, toCSV, download } from '../lib/format.js';
import ViewBar, { NodePicker } from '../components/ViewBar.jsx';
import { Spinner } from '../components/ui.jsx';
import { Crumbs } from './Dashboard.jsx';

export default function CompanyReport() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const { view, nodes, user, canEnter } = useApp();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [showMap, setShowMap] = useState(true);
  const head = sp.get('head');

  // default company: the user's own, else first company in view
  let companyId = Number(id) || null;
  if (!companyId) {
    if (user.role === 'company') companyId = user.node_id;
    else {
      const start = nodes.get(view.nodeId);
      const find = (n) => (n.type === 'company' ? n : n.children.map(find).find(Boolean));
      companyId = start ? find(start)?.id : null;
    }
  }

  useEffect(() => {
    if (!companyId) return undefined;
    let live = true;
    setErr('');
    api.get(`/consol/company${qs({ company: companyId, freq: view.freq, key: view.key, mode: view.mode, head })}`)
      .then((r) => live && setData(r)).catch((e) => live && setErr(e.message));
    return () => { live = false; };
  }, [companyId, view.freq, view.key, view.mode, head]);

  const picker = (
    <NodePicker value={companyId} onChange={(cid) => nav(`/company/${cid}`)} placeholder="Pick a company"
      filter={(n, picking) => (picking ? n.type === 'company' : true)} />
  );

  if (!companyId) return <><div className="topbar">{picker}</div><div className="content"><div className="empty">Pick a company</div></div></>;
  if (err) return <><div className="topbar">{picker}<ViewBar showNode={false} /></div><div className="content"><div className="alert err">{err}</div></div></>;
  if (!data) return <><div className="topbar">{picker}<ViewBar showNode={false} /></div><Spinner /></>;

  const s = view.scale;
  const hl = data.lines.some((l) => l.highlight);
  const exportCsv = () => {
    const rows = [['Code', 'Line', 'Group head', data.labels.cur, data.labels.prev || '', data.labels.ly]];
    data.lines.forEach((l) => rows.push([l.code, l.label, l.head_code || '', data.cur?.[l.id] ?? '', data.prev?.[l.id] ?? '', data.ly?.[l.id] ?? '']));
    download(`${data.company.code}-${data.key}-${data.mode}.csv`, toCSV(rows));
  };
  const filed = data.filings.filter((f) => f.revision);

  return (
    <>
      <div className="topbar">{picker}<ViewBar showNode={false} /></div>
      <div className="content stack">
        <div className="page-head">
          <div>
            <Crumbs path={data.path} onPick={() => nav('/report')} />
            <h1 style={{ marginTop: 4 }}>{data.company.name}</h1>
            <div className="sub">
              Own reporting format · {data.labels.cur} · {data.company.currency}
              {filed.length > 0 ? ` · filed rev ${filed.map((f) => f.revision).join(', ')} on ${filed[filed.length - 1].filed_at.slice(0, 10)}` : ''}
            </div>
          </div>
          <div className="spacer" />
          <label className="check"><input type="checkbox" checked={showMap} onChange={(e) => setShowMap(e.target.checked)} />Show group mapping</label>
          {hl && <Link to={`/company/${companyId}`}><button>Clear highlight</button></Link>}
          {canEnter(companyId) && data.mode === 'period' && <Link to={`/entry/${companyId}/${data.frequency}/${data.key}`}><button>Open entry</button></Link>}
          <button onClick={exportCsv}>Export CSV</button>
        </div>
        {!data.cur && <div className="alert warn">No figures filed for {data.labels.cur} yet.</div>}
        {data.lines.length === 0 ? <div className="card"><div className="empty">No filings found for this company and period.</div></div> : (
          <div className="card">
            <div className="card-b flush tablewrap">
              <table className="t">
                <thead>
                  <tr>
                    <th style={{ minWidth: 280 }}>Line</th>
                    {showMap && <th>Group head</th>}
                    <th className="num">{data.labels.cur}</th>
                    {data.labels.prev && <><th className="num locked">{data.labels.prev}</th><th className="num">Δ</th></>}
                    <th className="num locked">{data.labels.ly}</th><th className="num">Δ LY</th>
                  </tr>
                </thead>
                <tbody>
                  {data.lines.map((l) => {
                    if (l.line_type === 'header') {
                      return <tr key={l.id} className="hdr"><td colSpan={showMap ? 7 : 6} style={{ paddingLeft: 12 + l.indent * 16 }}>{l.label}</td></tr>;
                    }
                                        const vp = variance(data.cur?.[l.id], data.prev?.[l.id], l.hib, l.fmt);
                    const vl = variance(data.cur?.[l.id], data.ly?.[l.id], l.hib, l.fmt);
                    const fmt = l.fmt;
                    return (
                      <tr key={l.id} className={`${l.bold || l.line_type === 'formula' ? 'b' : ''} ${l.highlight ? 'hl' : ''}`}>
                        <td className="lbl" style={{ paddingLeft: 12 + l.indent * 16 }} title={l.formula ? `= ${l.formula}` : ''}>
                          {l.label}
                          {data.notes[l.id] && <span title={data.notes[l.id].join('\n')} style={{ marginLeft: 6, cursor: 'help' }}>💬</span>}
                        </td>
                        {showMap && <td>{l.head_code ? <span className="tag" title={l.head_name}>{l.head_code}{l.sign === -1 ? ' ×−1' : ''}</span> : l.line_type === 'formula' ? <span className="faint small">calc</span> : <span className="tag grey">unmapped</span>}</td>}
                        <td className="num">{fmtVal(data.cur?.[l.id], fmt, s)}</td>
                        {data.labels.prev && <><td className="num locked">{fmtVal(data.prev?.[l.id], fmt, s)}</td><td className="num"><span className={`delta ${l.head_id ? vp.cls : 'flat'}`}>{vp.text}</span></td></>}
                        <td className="num locked">{fmtVal(data.ly?.[l.id], fmt, s)}</td>
                        <td className="num"><span className={`delta ${l.head_id ? vl.cls : 'flat'}`}>{vl.text}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
        <div className="muted small">Figures in {data.company.currency}, exactly as the company filed them in its own format. Shaded columns are locked filings.</div>
      </div>
    </>
  );
}
