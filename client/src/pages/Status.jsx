import { Fragment, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../store.jsx';
import { api, qs } from '../lib/api.js';
import { NodeSelect, WeekSelect, Seg, Loading, St } from '../ui.jsx';

export default function Status() {
  const { view, setView } = useApp();
  const nav = useNavigate();
  const [kind, setKind] = useState('week');
  const [d, setD] = useState(null);
  useEffect(() => {
    if (!view.nodeId) return;
    setD(null);
    api.get(`/view/status${qs({ node: view.nodeId, week: view.week, kind })}`).then(setD).catch(() => {});
  }, [view.nodeId, view.week, kind]);

  let lastCluster = null;
  return (
    <>
      <div className="bar">
        <NodeSelect value={view.nodeId} onChange={(id) => setView({ nodeId: id })} />
        <Seg value={kind} options={[['week', 'Weekly'], ['month', 'Monthly']]} onChange={setKind} />
        {kind === 'week' && <WeekSelect value={view.week} onChange={(w) => setView({ week: w })} />}
      </div>
      {!d ? <Loading /> : (
        <div className="wrap">
          <table className="r">
            <thead>
              <tr>
                <th className="l first" style={{ minWidth: 170 }}>Company</th>
                {d.periods.map((p) => <th key={p.key} className="l gap">{p.label}<br /><span className="mute">{p.sub ? `${p.sub} · ` : ''}due {p.due.slice(5)}</span></th>)}
              </tr>
            </thead>
            <tbody>
              {d.rows.map((r) => {
                const head = r.cluster !== lastCluster;
                lastCluster = r.cluster;
                return (
                  <Fragment key={r.id}>
                    {head && r.cluster && <tr className="sec"><td colSpan={d.periods.length + 1} className="first">{r.cluster}</td></tr>}
                    <tr>
                      <td className="l first" style={{ whiteSpace: 'nowrap' }}>{r.name}</td>
                      {r.cells.map((c) => (
                        <td key={c.key} className="l gap" style={{ cursor: c.status === 'na' ? 'default' : 'pointer' }}
                          onClick={() => c.status !== 'na' && nav(kind === 'week' ? `/enter/${r.id}/${c.key}` : `/close/${r.id}/${c.key}`)}>
                          {c.status === 'na' ? '' : <St s={c.status} reopened={c.reopened} overdue={c.overdue} />}
                          {kind === 'month' && c.status === 'new' && !c.ready ? <span className="mute small"> · weeks pending</span> : null}
                        </td>
                      ))}
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
