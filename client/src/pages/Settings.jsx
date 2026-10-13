import { useEffect, useState } from 'react';
import { useApp } from '../store.jsx';
import { api } from '../lib/api.js';
import { Loading } from '../ui.jsx';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

export default function Settings() {
  const { notify } = useApp();
  const [s, setS] = useState(null);
  useEffect(() => { api.get('/settings').then(setS); }, []);
  if (!s) return <Loading />;
  const save = async () => { try { setS(await api.put('/settings', s)); notify('Saved'); } catch (e) { notify(e.message, 'err'); } };
  const f = (k, v) => setS({ ...s, [k]: v });
  return (
    <>
      <div className="bar"><h2>Settings</h2></div>
      <div style={{ display: 'grid', gap: 14, maxWidth: 420 }}>
        <label className="f">Group name<input value={s.group_name} onChange={(e) => f('group_name', e.target.value)} /></label>
        <label className="f">Currency<input value={s.group_currency} disabled /></label>
        <label className="f">Financial year starts
          <select value={s.fiscal_year_start_month} onChange={(e) => f('fiscal_year_start_month', e.target.value)}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
        </label>
        <label className="f">Weekly report due / entry cut-off day
          <select value={s.week_due_days} onChange={(e) => f('week_due_days', e.target.value)}>{DAYS.map((d, i) => <option key={d} value={i + 1}>{d}</option>)}</select>
        </label>
        <label className="f">Cut-off time (hour, Pakistan time)
          <select value={s.week_cutoff_hour} onChange={(e) => f('week_cutoff_hour', e.target.value)}>{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}</select>
        </label>
        <label className="f">Month close due (days after month end)<input type="number" value={s.month_due_days} onChange={(e) => f('month_due_days', e.target.value)} /></label>
        <div><button className="dark" onClick={save}>Save</button></div>
      </div>
    </>
  );
}
