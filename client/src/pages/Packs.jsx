import { Fragment, useEffect, useState } from 'react';
import { useApp } from '../store.jsx';
import { api } from '../lib/api.js';
import { Loading } from '../ui.jsx';

const KIND = { input: 'entered', sku_total: 'from SKUs', opening: 'carried forward', sum: 'total', formula: 'calculated', cfnet: 'from weeks', link: 'from weeks' };
const CF = { OPS: 'Operating', INV: 'Investing', FIN: 'Financing' };

export default function Packs() {
  const { notify } = useApp();
  const [d, setD] = useState(null);
  const [add, setAdd] = useState({});
  const load = () => api.get('/lines').then(setD);
  useEffect(() => { load(); }, []);
  if (!d) return <Loading />;
  const run = async (fn) => { try { await fn(); load(); } catch (e) { notify(e.message, 'err'); } };

  return (
    <>
      <div className="bar"><h2>Reporting lines</h2></div>
      <div className="wrap">
        <table className="r" style={{ maxWidth: 1000 }}>
          <thead><tr><th className="l">Line</th><th className="l">Type</th><th className="l">Cash flow</th><th className="l">Formula</th><th className="l">Budget</th><th className="l">On</th></tr></thead>
          <tbody>
            {d.sections.map((s) => (
              <Fragment key={s.code}>
                <tr className="sec">
                  <td colSpan={6}>
                    <input defaultValue={s.name} style={{ fontSize: 17, fontWeight: 'bold', border: 0, background: 'transparent', width: 380 }}
                      onBlur={(e) => e.target.value !== s.name && run(() => api.put(`/sections/${s.code}`, { name: e.target.value }))} />
                    <span className="small mute"> {s.scope === 'month' ? 'monthly' : 'weekly'}</span>
                  </td>
                </tr>
                {s.code === 'PRODSALES' && <tr><td className="l mute" colSpan={6}>Per company SKUs: production, sales quantity, sales value</td></tr>}
                {d.lines.filter((l) => l.section === s.code).map((l) => (
                  <Fragment key={l.id}>
                    <tr className={['sum', 'formula', 'cfnet'].includes(l.kind) ? 'tot' : ''} style={l.active ? undefined : { opacity: 0.45 }}>
                      <td className="l" style={{ paddingLeft: l.parent_id ? 24 : 8 }}>
                        <input defaultValue={l.name} style={{ border: 0, background: 'transparent', width: 340, fontWeight: 'inherit' }}
                          onBlur={(e) => e.target.value !== l.name && run(() => api.put(`/lines/${l.id}`, { name: e.target.value }))} />
                      </td>
                      <td className="l mute">{KIND[l.kind]}</td>
                      <td className="l mute">{l.cf ? `${l.cf[0] === '+' ? 'in' : 'out'} · ${CF[l.cf.slice(1)]}` : ''}</td>
                      <td className="l mute small">{l.kind === 'cfnet' ? CF[l.formula] : l.formula}</td>
                      <td className="l">{l.kind === 'input' && <input type="checkbox" checked={!!l.budget} onChange={(e) => run(() => api.put(`/lines/${l.id}`, { budget: e.target.checked }))} />}</td>
                      <td className="l">{!l.system && <input type="checkbox" checked={!!l.active} onChange={(e) => run(() => api.put(`/lines/${l.id}`, { active: e.target.checked }))} />}</td>
                    </tr>
                    {l.kind === 'sum' && (
                      <tr>
                        <td className="l" colSpan={6} style={{ paddingLeft: 24 }}>
                          <span className="row">
                            <input placeholder={`+ line under ${l.name}`} value={add[l.id]?.name || ''} onChange={(e) => setAdd({ ...add, [l.id]: { ...add[l.id], name: e.target.value } })} style={{ width: 300 }} />
                            {['REC_TOT', 'PAY_TOT'].includes(l.code) && (
                              <select value={add[l.id]?.cf || 'OPS'} onChange={(e) => setAdd({ ...add, [l.id]: { ...add[l.id], cf: e.target.value } })}>
                                {Object.entries(CF).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                              </select>
                            )}
                            <button disabled={!add[l.id]?.name} onClick={() => run(async () => { await api.post('/lines', { parent_id: l.id, name: add[l.id].name, cf: add[l.id].cf }); setAdd({ ...add, [l.id]: {} }); })}>Add</button>
                          </span>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
