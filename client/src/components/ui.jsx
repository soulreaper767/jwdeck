import { useEffect, useRef, useState } from 'react';
import { STATUS_LABEL } from '../lib/format.js';

const paths = {
  dash: 'M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z',
  report: 'M4 4h16v2H4zm0 5h10v2H4zm0 5h16v2H4zm0 5h10v2H4z',
  entry: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 000-1.41l-2.34-2.34a1 1 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z',
  status: 'M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
  tree: 'M22 11V3h-7v3H9V3H2v8h7V8h2v10h4v3h7v-8h-7v3h-2V8h2v3z',
  heads: 'M3 5h18v2H3zm4 6h14v2H7zm4 6h10v2H11z',
  format: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z',
  map: 'M20.5 3l-.16.03L15 5.1 9 3 3.36 4.9a.5.5 0 00-.36.48V20.5a.5.5 0 00.66.47L9 18.9l6 2.1 5.64-1.9a.5.5 0 00.36-.48V3.5a.5.5 0 00-.5-.5zM15 19l-6-2.11V5l6 2.11V19z',
  users: 'M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5C15 14.17 10.33 13 8 13zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z',
  settings: 'M19.14 12.94a7.07 7.07 0 000-1.88l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.49.49 0 00-.59-.22l-2.39.96a7.03 7.03 0 00-1.62-.94l-.36-2.54A.48.48 0 0013.93 2h-3.84a.48.48 0 00-.48.41l-.36 2.54c-.59.24-1.13.56-1.62.94l-2.39-.96a.49.49 0 00-.59.22L2.73 8.47a.48.48 0 00.12.61l2.03 1.58a7.07 7.07 0 000 1.88l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.25.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 00-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1112 8.4a3.6 3.6 0 010 7.2z',
  audit: 'M13 3a9 9 0 00-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.95 8.95 0 0013 21a9 9 0 000-18zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z',
  building: 'M12 7V3H2v18h20V7H12zM6 19H4v-2h2v2zm0-4H4v-2h2v2zm0-4H4V9h2v2zm0-4H4V5h2v2zm4 12H8v-2h2v2zm0-4H8v-2h2v2zm0-4H8V9h2v2zm0-4H8V5h2v2zm10 12h-8v-2h2v-2h-2v-2h2v-2h-2V9h8v10zm-2-8h-2v2h2v-2zm0 4h-2v2h2v-2z',
};

export const Icon = ({ name }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d={paths[name]} /></svg>
);

export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`}>
        <div className="modal-h"><h2>{title}</h2><div className="spacer" /><button className="ghost icon" onClick={onClose}>✕</button></div>
        <div className="modal-b">{children}</div>
        {footer && <div className="modal-f">{footer}</div>}
      </div>
    </div>
  );
}

export function Status({ status, overdue }) {
  if (overdue && status !== 'filed') return <span className="badge overdue">{status === 'draft' ? 'Draft · overdue' : 'Overdue'}</span>;
  return <span className={`badge ${status}`}>{STATUS_LABEL[status] || status}</span>;
}

export function Seg({ value, options, onChange }) {
  return (
    <div className="seg">
      {options.map(([v, l]) => (
        <button key={v} className={v === value ? 'on' : ''} onClick={() => onChange(v)} type="button">{l}</button>
      ))}
    </div>
  );
}

export function usePop() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  return { open, setOpen, ref };
}

const TYPE_ICON = { group: 'G', cluster: 'C', company: 'Co' };

export function TreeView({ roots, selected, onSelect, filter, defaultOpen = 2, render }) {
  return (
    <div className="tree">
      {roots.map((n) => <TreeNode key={n.id} n={n} depth={0} selected={selected} onSelect={onSelect} filter={filter} defaultOpen={defaultOpen} render={render} />)}
    </div>
  );
}

function TreeNode({ n, depth, selected, onSelect, filter, defaultOpen, render }) {
  const [open, setOpen] = useState(depth < defaultOpen);
  if (filter && !filter(n)) return null;
  const kids = n.children || [];
  return (
    <div>
      <div className={`tn ${selected === n.id ? 'sel' : ''} ${n.active === 0 ? 'off' : ''}`} style={{ paddingLeft: 8 + depth * 16 }}
        onClick={() => onSelect(n)}>
        <span className="tw" onClick={(e) => { e.stopPropagation(); setOpen(!open); }}>{kids.length ? (open ? '▾' : '▸') : ''}</span>
        <span className={`ico ${n.type}`}>{TYPE_ICON[n.type]}</span>
        <span className="grow">{n.name}</span>
        {render && render(n)}
      </div>
      {open && kids.map((c) => <TreeNode key={c.id} n={c} depth={depth + 1} selected={selected} onSelect={onSelect} filter={filter} defaultOpen={defaultOpen} render={render} />)}
    </div>
  );
}

export const Spinner = ({ text = 'Loading…' }) => <div className="spin">{text}</div>;

export function Confirm({ title, message, confirmText = 'Confirm', danger, onConfirm, onClose, input }) {
  const [val, setVal] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={title} onClose={onClose} footer={<>
      <button onClick={onClose}>Cancel</button>
      <button className={danger ? 'danger solid' : 'primary'} disabled={busy || (input && !val.trim())}
        onClick={async () => { setBusy(true); try { await onConfirm(val); onClose(); } finally { setBusy(false); } }}>{confirmText}</button>
    </>}>
      <div>{message}</div>
      {input && <label className="field">{input}<textarea rows={3} value={val} onChange={(e) => setVal(e.target.value)} autoFocus /></label>}
    </Modal>
  );
}
