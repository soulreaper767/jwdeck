import { useEffect, useState } from 'react';
import { useApp } from '../store.jsx';
import { api } from '../lib/api.js';
import { Seg, TreeView, usePop } from './ui.jsx';
import { SCALES } from '../lib/format.js';

export function usePeriods(freq) {
  const [p, setP] = useState(null);
  useEffect(() => {
    let live = true;
    api.get(`/periods?freq=${freq}`).then((r) => live && setP(r)).catch(() => {});
    return () => { live = false; };
  }, [freq]);
  return p;
}

export function NodePicker({ value, onChange, filter, placeholder = 'Select…' }) {
  const { tree, nodes } = useApp();
  const { open, setOpen, ref } = usePop();
  const sel = nodes.get(value);
  return (
    <div className="pop" ref={ref}>
      <button className="picker-btn" onClick={() => setOpen(!open)} type="button">
        <span>{sel ? sel.name : placeholder}</span><span className="faint">▾</span>
      </button>
      {open && (
        <div className="pop-panel">
          <TreeView roots={tree} selected={value} filter={filter} defaultOpen={3}
            onSelect={(n) => { if (!filter || filter(n, true)) { onChange(n.id); setOpen(false); } }} />
        </div>
      )}
    </div>
  );
}

export function PeriodSelect({ freq, value, onChange, periods, statusOf }) {
  const p = periods;
  if (!p) return <select disabled><option>…</option></select>;
  const v = value || p.last_closed;
  return (
    <select value={v} onChange={(e) => onChange(e.target.value)} style={{ minWidth: freq === 'weekly' ? 230 : 120 }}>
      {p.list.map((x) => (
        <option key={x.key} value={x.key}>
          {x.label}{x.key === p.current ? ' · current' : ''}{statusOf ? statusOf(x.key) : ''}
        </option>
      ))}
    </select>
  );
}

// Shared context bar: node / frequency / period / view mode / scale
export default function ViewBar({ showMode = true, showScale = true, showNode = true }) {
  const { view, setView } = useApp();
  const periods = usePeriods(view.freq);
  const key = view.key || periods?.last_closed;
  const modes = view.freq === 'monthly' ? [['period', 'Month'], ['qtd', 'QTD'], ['ytd', 'YTD']] : [['period', 'Week'], ['mtd', 'MTD']];
  return (
    <>
      {showNode && <NodePicker value={view.nodeId} onChange={(id) => setView({ nodeId: id })} />}
      <Seg value={view.freq} options={[['monthly', 'Monthly'], ['weekly', 'Weekly']]} onChange={(f) => setView({ freq: f })} />
      <PeriodSelect freq={view.freq} value={key} periods={periods} onChange={(k) => setView({ key: k })} />
      {showMode && <Seg value={view.mode} options={modes} onChange={(m) => setView({ mode: m })} />}
      {showMode && (
        <label className="check" title="Compare only companies that have filed the current period, so late filers don't look like a drop">
          <input type="checkbox" checked={view.lfl !== false} onChange={(e) => setView({ lfl: e.target.checked })} />Like-for-like
        </label>
      )}
      <div className="spacer" />
      {showScale && (
        <select value={view.scale} onChange={(e) => setView({ scale: e.target.value })} title="Display units">
          {Object.entries(SCALES).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
        </select>
      )}
    </>
  );
}
