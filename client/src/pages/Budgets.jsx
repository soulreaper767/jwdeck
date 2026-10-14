import { Fragment, useEffect, useState } from 'react';
import { useApp } from '../store.jsx';
import { api } from '../lib/api.js';
import { fv, parseNum, plainNum } from '../lib/format.js';
import { NodeSelect, Seg, Loading, Logo, PrintButton, PrintHeader } from '../ui.jsx';

const fyName = (y) => `FY${String(y).slice(2)}-${String(y + 1).slice(2)}`;

// Cluster / group: every company's budget added up (read-only)
function ConsolidatedBudget({ nodeId, onPick }) {
  const { notify, view } = useApp();
  const [fy, setFy] = useState(null);
  const [d, setD] = useState(null);
  const unit = view.unit;
  useEffect(() => {
    setD(null);
    api.get(`/budgets-node/${nodeId}${fy ? `?fy=${fy}` : ''}`).then((r) => { setD(r); if (!fy) setFy(r.fy); }).catch((e) => notify(e.message, 'err'));
  }, [nodeId, fy, notify]);
  if (!d) return <><div className="bar"><NodeSelect value={nodeId} onChange={onPick} /></div><Loading /></>;
  const fmtOf = (x) => (x.fmt === 'qty' || x.fmt === 'number' ? 'qty' : x.fmt === 'percent' ? 'percent' : 'amount');
  const cols = 3 + d.months.length;
  return (
    <>
      <div className="bar">
        <NodeSelect value={nodeId} onChange={onPick} />
        <Seg value={d.fy} options={[d.fy - 1, d.fy, d.fy + 1].map((y) => [y, fyName(y)])} onChange={setFy} />
        <span className="sp" />
        <PrintButton />
      </div>
      <PrintHeader node={d.node} title="Consolidated budget" period={d.fy_label} />
      <div className="title"><Logo node={d.node} /><h1>{d.node.name}</h1><span className="meta">Consolidated budget {d.fy_label} · PKR millions / units</span></div>
      <div className="wrap" style={{ marginTop: 10 }}>
        <table className="r">
          <thead>
            <tr className="g"><th className="l first" /><th className="gap">{d.fy_label}</th><th colSpan={d.months.length} className="gap">Monthly budget</th></tr>
            <tr>
              <th className="l first" style={{ minWidth: 220 }} />
              <th className="gap">Annual</th>
              {d.months.map((m, i) => <th key={m.key} className={i === 0 ? 'gap' : ''}>{m.label.slice(0, 3)}<br /><span style={{ fontWeight: 'normal' }}>{m.label.slice(4)}</span></th>)}
            </tr>
          </thead>
          <tbody>
            {d.sections.map((s) => {
              const rows = s.rows.filter((x) => !x.group && (x.annual != null || x.months.some((v) => v != null)));
              if (!rows.length) return null;
              return (
                <Fragment key={s.code}>
                  <tr className="sec"><td colSpan={cols} className="first">{s.name}</td></tr>
                  {rows.map((x) => (
                    <tr key={x.code} className={x.grand ? 'grand' : x.strong ? 'tot' : ''}>
                      <td className="l first" style={{ paddingLeft: 8 + (x.depth || 0) * 16 }}>{x.name}</td>
                      <td className="n gap" style={{ fontWeight: 'bold' }}>{fv(x.annual, fmtOf(x), unit)}</td>
                      {x.months.map((v, i) => <td key={i} className={`n ${i === 0 ? 'gap' : ''}`}>{fv(v, fmtOf(x), unit)}</td>)}
                    </tr>
                  ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <h2 className="part">Annual budget by company</h2>
      <div className="wrap">
        <table className="r">
          <thead><tr><th className="l first">Company</th>{d.keys.map((k) => <th key={k.code} className="gap">{k.name}</th>)}</tr></thead>
          <tbody>
            {d.by_company.map((c) => (
              <tr key={c.id} className="click" onClick={() => onPick(c.id)}>
                <td className="l first">{c.name}</td>
                {d.keys.map((k) => <td key={k.code} className="n gap">{fv(c.values[k.code], 'amount', unit)}</td>)}
              </tr>
            ))}
            <tr className="tot">
              <td className="l first">Total</td>
              {d.keys.map((k) => <td key={k.code} className="n gap">{fv(d.by_company.reduce((a, c) => a + (c.values[k.code] || 0), 0), 'amount', unit)}</td>)}
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function Budgets() {
  const { nodes, notify, view } = useApp();
  const [cid, setCid] = useState(null);
  const [fy, setFy] = useState(null);
  const [d, setD] = useState(null);
  const [annual, setAnnual] = useState({});
  const [spec, setSpec] = useState({});
  const [dirty, setDirty] = useState(false);
  const selected = cid || view.nodeId || [...nodes.values()].find((n) => n.type === 'company')?.id;
  const isCompany = nodes.get(selected)?.type === 'company';
  const company = isCompany ? selected : null;

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

  if (!isCompany && selected) return <ConsolidatedBudget nodeId={selected} onPick={(id) => { if (!dirty || window.confirm('Discard changes?')) setCid(id); }} />;
  if (!d) return <><div className="bar"><NodeSelect value={selected} onChange={setCid} /></div><Loading /></>;

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
        <NodeSelect value={company} onChange={(c) => { if (!dirty || window.confirm('Discard changes?')) setCid(c); }} />
        <Seg value={d.fy} options={[d.fy - 1, d.fy, d.fy + 1].map((y) => [y, fyName(y)])} onChange={(y) => { if (!dirty || window.confirm('Discard changes?')) setFy(y); }} />
        <span className="sp" />
        {ed && <button className="dark" disabled={!dirty} onClick={save}>Save{dirty ? ' •' : ''}</button>}
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
