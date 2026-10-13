import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../store.jsx';
import { api, qs } from '../lib/api.js';
import { NodeSelect, WeekSelect, Loading, St } from '../ui.jsx';

export default function Status() {
  const { view, setView, canEnter } = useApp();
  const nav = useNavigate();
  const [d, setD] = useState(null);
  useEffect(() => {
    if (!view.nodeId) return;
    api.get(`/view/status${qs({ node: view.nodeId, week: view.week, n: 8 })}`).then(setD).catch(() => {});
  }, [view.nodeId, view.week]);

  return (
    <>
      <div className="bar">
        <NodeSelect value={view.nodeId} onChange={(id) => setView({ nodeId: id })} />
        <WeekSelect value={view.week} onChange={(w) => setView({ week: w })} />
      </div>
      {!d ? <Loading /> : (
        <div className="wrap">
          <table className="r">
            <thead>
              <tr>
                <th className="l">Company</th>
                {d.weeks.map((w) => <th key={w.key} className="l gap">{w.key.slice(5)}<br /><span className="mute">due {w.due.slice(5)}</span></th>)}
              </tr>
            </thead>
            <tbody>
              {d.rows.map((r) => (
                <tr key={r.id}>
                  <td className="l"><b>{r.name}</b><br /><span className="mute small">{r.cluster}</span></td>
                  {r.cells.map((c) => (
                    <td key={c.week} className={`l gap ${c.status !== 'na' ? 'click' : ''}`} style={{ cursor: c.status !== 'na' && canEnter(r.id) ? 'pointer' : 'default' }}
                      onClick={() => c.status !== 'na' && canEnter(r.id) && nav(`/enter/${r.id}/${c.week}`)}>
                      {c.status === 'na' ? <span className="mute">{r.setup ? '' : '—'}</span> : <St s={c.status} overdue={c.overdue} />}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
