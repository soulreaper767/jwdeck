import { Fragment, useEffect, useState } from 'react';
import { useApp } from '../store.jsx';
import { api } from '../lib/api.js';
import { Loading } from '../ui.jsx';

const KIND = { input: 'entered', sku_total: 'from SKUs', opening: 'carried forward', sum: 'total', formula: 'calculated' };

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
      <table className="r" style={{ maxWidth: 900 }}>
        <thead><tr><th className="l">Line</th><th className="l">Type</th><th className="l">Formula</th><th className="l">Budget</th><th className="l">On</th></tr></thead>
        <tbody>
          {d.sections.map((s) => (
            <Fragment key={s.code}>
              <tr className="sec">
                <td colSpan={5}>
                  <input defaultValue={s.name} style={{ fontFamily: 'Georgia, serif', fontSize: 15, border: 0, background: 'transparent', width: 400 }}
                    onBlur={(e) => e.target.value !== s.name && run(() => api.put(`/sections/${s.code}`, { name: e.target.value }))} />
                </td>
              </tr>
              {s.code === 'PRODSALES' && <tr><td className="l mute" colSpan={5}>Per company SKUs: production, sales quantity, sales value</td></tr>}
              {d.lines.filter((l) => l.section === s.code).map((l) => (
                <Fragment key={l.id}>
                  <tr className={l.kind === 'sum' || l.kind === 'formula' ? 'tot' : ''} style={l.active ? undefined : { opacity: 0.45 }}>
                    <td className="l" style={{ paddingLeft: l.parent_id ? 24 : 8 }}>
                      <input defaultValue={l.name} style={{ border: 0, background: 'transparent', width: 330, fontWeight: 'inherit' }}
                        onBlur={(e) => e.target.value !== l.name && run(() => api.put(`/lines/${l.id}`, { name: e.target.value }))} />
                    </td>
                    <td className="l mute">{KIND[l.kind]}</td>
                    <td className="l mute small">{l.formula}</td>
                    <td className="l">{l.kind === 'input' && <input type="checkbox" checked={!!l.budget} onChange={(e) => run(() => api.put(`/lines/${l.id}`, { budget: e.target.checked }))} />}</td>
                    <td className="l">{!l.system && <input type="checkbox" checked={!!l.active} onChange={(e) => run(() => api.put(`/lines/${l.id}`, { active: e.target.checked }))} />}</td>
                  </tr>
                  {l.kind === 'sum' && (
                    <tr>
                      <td className="l" colSpan={5} style={{ paddingLeft: 24 }}>
                        <input placeholder={`+ line under ${l.name}`} value={add[l.id] || ''} onChange={(e) => setAdd({ ...add, [l.id]: e.target.value })}
                          onKeyDown={(e) => e.key === 'Enter' && add[l.id] && run(async () => { await api.post('/lines', { parent_id: l.id, name: add[l.id] }); setAdd({ ...add, [l.id]: '' }); })}
                          style={{ width: 330 }} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </>
  );
}
