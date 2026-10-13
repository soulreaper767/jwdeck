import { Fragment, useEffect, useState } from 'react';
import { useApp } from '../store.jsx';
import { api } from '../lib/api.js';
import { fv, parseNum, plainNum } from '../lib/format.js';
import { NodeSelect, Seg, Loading } from '../ui.jsx';

export default function Budgets() {
  const { user, nodes, canEnter, notify } = useApp();
  const [cid, setCid] = useState(() => (user.role === 'company' ? user.node_id : null));
  const [fy, setFy] = useState(null);
  const [d, setD] = useState(null);
  const [annual, setAnnual] = useState({});
  const [spec, setSpec] = useState({});
  const [dirty, setDirty] = useState(false);
  const company = cid || [...nodes.values()].find((n) => n.type === 'company')?.id;

  useEffect(() => {
    if (!company) return;
    setD(null);
    api.get(`/budgets/${company}${fy ? `?fy=${fy}` : ''}`).then((r) => {
      setD(r);
      if (!fy) setFy(r.fy);
      setAnnual(Object.fromEntries(Object.entries(r.annual).map(([k, v]) => [k, plainNum(v)])));
      const sp = {};
      for (const [k, byM] of Object.entries(r.specific)) sp[k] = Object.fromEntries(Object.entries(byM).map(([m, v]) => [m, plainNum(v)]));
      setSpec(sp);
      setDirty(false);
    }).catch((e) => notify(e.message, 'err'));
  }, [company, fy, notify]);

  if (!d) return <><div className="bar"><NodeSelect value={company} companiesOnly onChange={setCid} /></div><Loading /></>;

  const fyDays = d.months.reduce((a, m) => a + m.days, 0);
  const monthVal = (item, m) => {
    const a = parseNum(annual[item]);
    const sv = spec[item] || {};
    const sSum = Object.values(sv).reduce((t, x) => t + (parseNum(x) || 0), 0);
    const own = parseNum(sv[m.key]) || 0;
    if (a == null || Number.isNaN(a)) return Object.keys(sv).length ? own : null;
    return own + ((a - sSum) * m.days) / fyDays;
  };
  const ed = d.editable;
  const save = async () => {
    try {
      const body = { fy: d.fy, annual: {}, specific: {} };
      for (const [k, v] of Object.entries(annual)) body.annual[k] = parseNum(v);
      for (const [k, byM] of Object.entries(spec)) body.specific[k] = Object.fromEntries(Object.entries(byM).map(([m, v]) => [m, parseNum(v)]));
      await api.put(`/budgets/${company}`, body);
      notify('Saved');
      setDirty(false);
    } catch (e) { notify(e.message, 'err'); }
  };
  const onPaste = (e, item, mi) => {
    const cells = e.clipboardData.getData('text').split(/\t|\r?\n/).filter((x) => x !== '');
    if (cells.length < 2) return;
    e.preventDefault();
    setSpec((s) => { const n = { ...s, [item]: { ...(s[item] || {}) } }; cells.forEach((c, j) => { const m = d.months[mi + j]; if (m) n[item][m.key] = c.trim(); }); return n; });
    setDirty(true);
  };

  const groups = d.sections.map((s) => ({ ...s, items: d.items.filter((i) => i.section === s.code) })).filter((g) => g.items.length);
  const cols = 3 + d.months.length;

  return (
    <>
      <div className="bar">
        <NodeSelect value={company} companiesOnly onChange={(c) => { if (!dirty || window.confirm('Discard changes?')) setCid(c); }} />
        <Seg value={d.fy} options={[d.fy - 1, d.fy, d.fy + 1].map((y) => [y, `FY${String(y).slice(2)}-${String(y + 1).slice(2)}`])} onChange={(y) => { if (!dirty || window.confirm('Discard changes?')) setFy(y); }} />
        <span className="sp" />
        {ed && canEnter(company) !== undefined && <button className="dark" disabled={!dirty} onClick={save}>Save{dirty ? ' •' : ''}</button>}
      </div>
      <div className="title"><h1>{d.company.name}</h1><span className="meta">Budget {d.fy_label} · PKR / units</span></div>
      <div className="wrap entry" style={{ marginTop: 10 }}>
        <table className="r">
          <thead>
            <tr>
              <th className="l" style={{ minWidth: 220 }} />
              <th className="gap">Annual</th>
              {d.months.map((m, i) => <th key={m.key} className={i === 0 ? 'gap' : ''}>{m.label.slice(0, 3)}<br /><span className="mute">{m.label.slice(4)}</span></th>)}
              <th className="gap">Spread</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <Fragment key={g.code}>
                <tr className="sec"><td colSpan={cols}>{g.name}</td></tr>
                {g.items.map((it) => {
                  const total = d.months.reduce((a, m) => a + (monthVal(it.key, m) || 0), 0);
                  const a = parseNum(annual[it.key]);
                  const off = a != null && !Number.isNaN(a) && Math.abs(total - a) > 1;
                  return (
                    <tr key={it.key}>
                      <td className="l">{it.label}</td>
                      <td className="n gap">
                        <input className="v" disabled={!ed} value={annual[it.key] ?? ''} onChange={(e) => { setAnnual({ ...annual, [it.key]: e.target.value }); setDirty(true); }}
                          onBlur={(e) => { const n = parseNum(e.target.value); if (n != null && !Number.isNaN(n)) setAnnual({ ...annual, [it.key]: plainNum(n) }); }} />
                      </td>
                      {d.months.map((m, i) => {
                        const own = spec[it.key]?.[m.key];
                        const v = monthVal(it.key, m);
                        return (
                          <td key={m.key} className={`n ${i === 0 ? 'gap' : ''}`}>
                            <input className="v" style={{ width: 92, fontWeight: own ? 600 : 400 }} disabled={!ed}
                              value={own ?? ''} placeholder={v == null ? '' : fv(v, it.qty ? 'qty' : 'amount', '1')}
                              onChange={(e) => { setSpec({ ...spec, [it.key]: { ...(spec[it.key] || {}), [m.key]: e.target.value } }); setDirty(true); }}
                              onPaste={(e) => onPaste(e, it.key, i)} />
                          </td>
                        );
                      })}
                      <td className={`n gap ${off ? 'bad' : 'mute'}`}>{total ? fv(total, it.qty ? 'qty' : 'amount', '1') : ''}</td>
                    </tr>
                  );
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
