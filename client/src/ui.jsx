import { useEffect, useState } from 'react';
import { useApp } from './store.jsx';
import { STATUS, fv } from './lib/format.js';

export function NodeSelect({ value, onChange, companiesOnly, allowEmpty }) {
  const { nodes } = useApp();
  return (
    <select value={value || ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
      {allowEmpty && <option value="">{allowEmpty}</option>}
      {[...nodes.values()].filter((n) => !companiesOnly || n.type === 'company').map((n) => (
        <option key={n.id} value={n.id}>{companiesOnly ? n.name : `${'   '.repeat(n.depth)}${n.name}`}</option>
      ))}
    </select>
  );
}

export function WeekSelect({ value, onChange, from }) {
  const { periods } = useApp();
  if (!periods) return <select disabled />;
  return (
    <select value={value || periods.last_closed} onChange={(e) => onChange(e.target.value)}>
      {periods.weeks.filter((w) => !from || w.key >= from).map((w) => (
        <option key={w.key} value={w.key}>{w.label}{w.segments.length > 1 ? '  (month end)' : ''}</option>
      ))}
    </select>
  );
}

export function MonthSelect({ value, onChange }) {
  const { periods } = useApp();
  if (!periods) return <select disabled />;
  return (
    <select value={value || periods.current_month} onChange={(e) => onChange(e.target.value)}>
      {periods.months.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
    </select>
  );
}

export function UnitSelect() {
  const { view, setView } = useApp();
  return <Seg value={view.unit === '1' ? '1' : 'm'} options={[['m', 'Millions'], ['1', 'Full']]} onChange={(u) => setView({ unit: u })} />;
}

// A reported figure: shows in the chosen unit, full amount on hover
export const Num = ({ v, fmt, unit, className = '' }) => (
  <td className={`n ${className}`} title={v == null || fmt === 'percent' ? undefined : fv(v, fmt === 'qty' ? 'qty' : fmt, '1')}>{fv(v, fmt, unit)}</td>
);

export const Seg = ({ value, options, onChange }) => (
  <span className="seg">{options.map(([v, l]) => <button key={v} type="button" className={v === value ? 'on' : ''} onClick={() => onChange(v)}>{l}</button>)}</span>
);

export const St = ({ s, overdue }) => (
  <span><span className={`st ${overdue ? 'overdue' : s}`} />{overdue ? `${STATUS[s]} · late` : STATUS[s]}</span>
);

export function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`}>
        <div className="row"><h2>{title}</h2><span className="sp" /><button className="link" onClick={onClose}>close</button></div>
        {children}
      </div>
    </div>
  );
}

export function Ask({ title, label, onOk, onClose, okText = 'OK' }) {
  const [v, setV] = useState('');
  return (
    <Modal title={title} onClose={onClose}>
      {label && <label className="f">{label}<textarea rows={3} value={v} onChange={(e) => setV(e.target.value)} autoFocus /></label>}
      <div className="row"><span className="sp" /><button onClick={onClose}>Cancel</button>
        <button className="dark" disabled={label && !v.trim()} onClick={async () => { await onOk(v); onClose(); }}>{okText}</button></div>
    </Modal>
  );
}

export const Loading = () => <div className="empty">Loading…</div>;
