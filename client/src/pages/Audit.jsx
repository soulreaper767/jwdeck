import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Loading } from '../ui.jsx';

export default function Audit() {
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');
  useEffect(() => { api.get('/audit?limit=500').then(setRows); }, []);
  const shown = rows?.filter((r) => !q || JSON.stringify(r).toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <div className="bar"><h2>Log</h2><span className="sp" /><input placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      {!rows ? <Loading /> : (
        <table className="r">
          <thead><tr><th className="l">When (UTC)</th><th className="l">Who</th><th className="l">Action</th><th className="l">Detail</th></tr></thead>
          <tbody>{shown.map((r) => (
            <tr key={r.id}><td className="l small">{r.at}</td><td className="l">{r.user_name || '—'}</td><td className="l">{r.action}</td><td className="l small mute">{r.detail}</td></tr>
          ))}</tbody>
        </table>
      )}
    </>
  );
}
