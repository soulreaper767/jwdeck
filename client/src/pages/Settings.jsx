import { useEffect, useState } from 'react';
import { useApp } from '../store.jsx';
import { api } from '../lib/api.js';
import { Spinner } from '../components/ui.jsx';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export default function Settings() {
  const { notify, refreshMe } = useApp();
  const [s, setS] = useState(null);
  const [fx, setFx] = useState([]);
  const [nf, setNf] = useState({ currency: 'USD', month_key: new Date().toISOString().slice(0, 7), rate: '' });

  const loadFx = () => api.get('/fx').then(setFx);
  useEffect(() => { api.get('/settings').then(setS); loadFx(); }, []);

  if (!s) return <Spinner />;
  const set = (k, v) => setS((x) => ({ ...x, [k]: v }));
  const save = async () => {
    try { setS(await api.put('/settings', s)); await refreshMe(); notify('Settings saved'); } catch (e) { notify(e.message, 'err'); }
  };
  const addFx = async () => {
    try { await api.put('/fx', nf); notify('Rate saved'); setNf((x) => ({ ...x, rate: '' })); loadFx(); } catch (e) { notify(e.message, 'err'); }
  };
  const byCcy = fx.reduce((a, r) => { (a[r.currency] ||= []).push(r); return a; }, {});

  return (
    <>
      <div className="topbar"><h2>Settings & FX</h2></div>
      <div className="content">
        <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', alignItems: 'start' }}>
          <div className="card">
            <div className="card-h"><h2>Group settings</h2></div>
            <div className="card-b stack">
              <label className="field">Group name<input value={s.group_name} onChange={(e) => set('group_name', e.target.value)} /></label>
              <div className="form2">
                <label className="field">Group reporting currency<input value={s.group_currency} maxLength={3} onChange={(e) => set('group_currency', e.target.value.toUpperCase())} /></label>
                <label className="field">Fiscal year starts in<select value={s.fiscal_year_start_month} onChange={(e) => set('fiscal_year_start_month', e.target.value)}>
                  {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></label>
                <label className="field">Weekly figures due (days after week end)<input type="number" value={s.weekly_due_days} onChange={(e) => set('weekly_due_days', e.target.value)} /></label>
                <label className="field">Monthly figures due (days after month end)<input type="number" value={s.monthly_due_days} onChange={(e) => set('monthly_due_days', e.target.value)} /></label>
              </div>
              <div><button className="primary" onClick={save}>Save settings</button></div>
            </div>
          </div>
          <div className="card">
            <div className="card-h"><h2>FX rates</h2><span className="muted small">{s.group_currency} per 1 unit of foreign currency, by month</span></div>
            <div className="card-b stack">
              <div className="row wrap">
                <input value={nf.currency} maxLength={3} onChange={(e) => setNf({ ...nf, currency: e.target.value.toUpperCase() })} style={{ width: 70 }} />
                <input type="month" value={nf.month_key} onChange={(e) => setNf({ ...nf, month_key: e.target.value })} />
                <input placeholder="Rate" value={nf.rate} onChange={(e) => setNf({ ...nf, rate: e.target.value })} style={{ width: 110 }} />
                <button className="primary" onClick={addFx}>Save rate</button>
              </div>
              <div className="muted small">Each period is translated at its month's rate. If a month has no rate, the latest earlier rate is used.
                Weekly figures use the rate of the month the week falls in.</div>
              {Object.entries(byCcy).map(([ccy, rows]) => (
                <div key={ccy}>
                  <h3 style={{ margin: '8px 0' }}>{ccy}</h3>
                  <div style={{ maxHeight: 260, overflow: 'auto' }}>
                    <table className="t">
                      <tbody>{rows.map((r) => (
                        <tr key={r.month_key}><td>{r.month_key}</td><td className="num">{r.rate}</td>
                          <td className="num"><button className="ghost sm danger" onClick={async () => { await api.del(`/fx/${ccy}/${r.month_key}`); loadFx(); }}>✕</button></td></tr>
                      ))}</tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
