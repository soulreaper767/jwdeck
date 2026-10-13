import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Spinner } from '../components/ui.jsx';

const LABEL = {
  'entry.file': 'Filed figures', 'entry.refile': 'Refiled figures', 'entry.reopen': 'Reopened filing',
  'format.save': 'Saved reporting format', 'node.create': 'Created unit', 'node.update': 'Updated unit', 'node.delete': 'Deleted unit',
  'head.create': 'Created head', 'head.update': 'Updated head', 'head.delete': 'Deleted head',
  'user.create': 'Created user', 'user.update': 'Updated user', 'settings.update': 'Changed settings', 'fx.set': 'Set FX rate',
};

export default function Audit() {
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');
  useEffect(() => { api.get('/audit?limit=500').then(setRows); }, []);
  const shown = rows?.filter((r) => !q || JSON.stringify(r).toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <div className="topbar"><h2>Audit log</h2><div className="spacer" /><input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <div className="content">
        {!rows ? <Spinner /> : (
          <div className="card"><div className="card-b flush tablewrap">
            <table className="t">
              <thead><tr><th>When (UTC)</th><th>Who</th><th>Action</th><th>Details</th></tr></thead>
              <tbody>{shown.map((r) => (
                <tr key={r.id}>
                  <td className="small" style={{ whiteSpace: 'nowrap' }}>{r.at}</td>
                  <td>{r.user_name || '—'}</td>
                  <td>{LABEL[r.action] || r.action}</td>
                  <td className="small muted" style={{ maxWidth: 520, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.detail}</td>
                </tr>
              ))}</tbody>
            </table>
            {shown.length === 0 && <div className="empty">No entries</div>}
          </div></div>
        )}
      </div>
    </>
  );
}
