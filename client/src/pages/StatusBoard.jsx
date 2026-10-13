import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../store.jsx';
import { api, qs } from '../lib/api.js';
import ViewBar from '../components/ViewBar.jsx';
import { Spinner, Status } from '../components/ui.jsx';
import { STATUS_LABEL } from '../lib/format.js';

export default function StatusBoard() {
  const { view, canEnter } = useApp();
  const nav = useNavigate();
  const [matrix, setMatrix] = useState(null);
  const [status, setStatus] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!view.nodeId) return undefined;
    let live = true;
    const q = qs({ node: view.nodeId, freq: view.freq, key: view.key, n: view.freq === 'weekly' ? 8 : 6 });
    Promise.all([api.get(`/consol/status-matrix${q}`), api.get(`/consol/status${q}`)])
      .then(([m, s]) => { if (live) { setMatrix(m); setStatus(s); } })
      .catch((e) => live && setErr(e.message));
    return () => { live = false; };
  }, [view.nodeId, view.freq, view.key]);

  const open = (companyId, key) => (canEnter(companyId) ? nav(`/entry/${companyId}/${view.freq}/${key}`) : nav(`/company/${companyId}`));

  return (
    <>
      <div className="topbar"><ViewBar showMode={false} showScale={false} /></div>
      <div className="content stack">
        {err && <div className="alert err">{err}</div>}
        {!status ? <Spinner /> : (
          <>
            <div className="page-head">
              <div>
                <h1>Filing status</h1>
                <div className="sub">{status.period.label} · due {status.due}</div>
              </div>
            </div>
            <div className="kpis">
              {[['Filed', status.summary.filed, 'var(--good)'], ['Draft', status.summary.draft, 'var(--warn)'], ['Reopened', status.summary.reopened, '#6b3fc4'],
                ['Not filed', status.summary.missing, 'var(--muted)'], ['Overdue', status.summary.overdue, 'var(--bad)']].map(([t, v, col]) => (
                <div key={t} className="card kpi" style={{ cursor: 'default' }}>
                  <div className="t">{t}</div><div className="v" style={{ color: col }}>{v}<span className="faint small"> / {status.summary.total}</span></div>
                </div>
              ))}
            </div>
            <div className="card">
              <div className="card-h"><h2>Companies × periods</h2><span className="muted small">click a cell to open it</span>
                <div className="spacer" />
                <div className="row small muted">{['filed', 'draft', 'reopened', 'missing', 'overdue'].map((s) => (
                  <span key={s} className="row" style={{ gap: 4 }}><span className={`cell ${s}`} style={{ width: 14, height: 14 }} />{s === 'overdue' ? 'Overdue' : STATUS_LABEL[s]}</span>
                ))}</div>
              </div>
              <div className="card-b flush" style={{ overflowX: 'auto' }}>
                <table className="t">
                  <thead>
                    <tr><th>Company</th>{matrix.periods.map((p) => <th key={p.key} className="num" style={{ minWidth: 80 }}>{p.label}</th>)}<th>Latest</th></tr>
                  </thead>
                  <tbody>
                    {matrix.rows.map((r) => {
                      const st = status.rows.find((x) => x.company_id === r.id);
                      return (
                        <tr key={r.id}>
                          <td className="lbl"><b>{r.name}</b><div className="faint small">{r.path}</div></td>
                          {r.cells.map((c) => {
                            const cls = c.status !== 'filed' && c.overdue ? 'overdue' : c.status;
                            return (
                              <td key={c.key} style={{ padding: '6px 6px' }}>
                                <div className={`cell ${cls}`} style={{ cursor: 'pointer' }} title={`${r.name} · ${c.key} · ${STATUS_LABEL[c.status]}`}
                                  onClick={() => open(r.id, c.key)}>
                                  {c.status === 'filed' ? '✓' : c.status === 'draft' ? '✎' : c.status === 'reopened' ? '↺' : c.overdue ? '!' : ''}
                                </div>
                              </td>
                            );
                          })}
                          <td>{st && <Status status={st.status} overdue={st.overdue} />}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {matrix.rows.length === 0 && <div className="empty">No active companies under this node.</div>}
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
