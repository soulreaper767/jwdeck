import { Fragment, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Seg, Spinner } from '../components/ui.jsx';

export default function Mapping() {
  const [freq, setFreq] = useState('monthly');
  const [data, setData] = useState(null);
  const [heads, setHeads] = useState([]);
  const [gapsOnly, setGapsOnly] = useState(false);

  useEffect(() => { api.get('/heads').then(setHeads); }, []);
  useEffect(() => { setData(null); api.get(`/mapping?frequency=${freq}`).then(setData); }, [freq]);

  if (!data) return <><div className="topbar"><h2>Mapping matrix</h2></div><Spinner /></>;
  const inputHeads = heads.filter((h) => h.head_type === 'input' && (h.frequency === 'both' || h.frequency === freq));
  const cell = (hid, cid) => data.rows.filter((r) => r.head_id === hid && r.company_id === cid);
  const rows = gapsOnly ? inputHeads.filter((h) => data.companies.some((c) => !cell(h.id, c.id).length)) : inputHeads;

  return (
    <>
      <div className="topbar">
        <h2>Mapping matrix</h2>
        <Seg value={freq} options={[['monthly', 'Monthly'], ['weekly', 'Weekly']]} onChange={setFreq} />
        <label className="check"><input type="checkbox" checked={gapsOnly} onChange={(e) => setGapsOnly(e.target.checked)} />Only heads with gaps</label>
      </div>
      <div className="content stack">
        <div className="muted">Each cell shows the company's own line(s) feeding a group head. Empty cells mean the company does not report that head
          (fine for weekly or for heads that don't apply to it). Click a company to edit its format.</div>
        <div className="card"><div className="card-b flush tablewrap">
          <table className="t">
            <thead>
              <tr>
                <th style={{ minWidth: 200, position: 'sticky', left: 0, zIndex: 2 }}>Group head</th>
                {data.companies.map((c) => (
                  <th key={c.id} style={{ minWidth: 150 }}>
                    <Link to={`/setup/formats/${c.id}/${freq}`}>{c.name}</Link>
                    <div className="faint" style={{ textTransform: 'none' }}>{data.line_counts[c.id] || 0} lines</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((h) => (
                <tr key={h.id}>
                  <td style={{ position: 'sticky', left: 0, background: '#fff', paddingLeft: 12 + h.depth * 12 }}><b>{h.name}</b> <span className="faint small">{h.code}</span></td>
                  {data.companies.map((c) => {
                    const ls = cell(h.id, c.id);
                    return (
                      <td key={c.id} className="small" style={ls.length ? undefined : { background: '#fafbfc' }}>
                        {ls.length ? ls.map((l, i) => <Fragment key={l.code}>{i > 0 && <br />}{l.label}{l.sign === -1 && <span className="faint"> ×−1</span>}</Fragment>)
                          : <span className="faint">–</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div></div>
      </div>
    </>
  );
}
