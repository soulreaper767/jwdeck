import { useEffect, useState } from 'react';
import { useApp } from './store.jsx';
import { api } from './lib/api.js';
import { fv } from './lib/format.js';

export const STATUS = {
  na: '', new: 'Not started', draft: 'Draft', submitted: 'Submitted', company_ok: 'Company approved',
  cluster_ok: 'Cluster approved', approved: 'Approved', reopened: 'Reopened', lapsed: 'Lapsed – no figures',
};
const ACTION = { submit: 'Submitted', approve: 'Approved', reopen: 'Reopened' };
const ROLE = { admin: 'Admin', executive: 'Executive', group_reviewer: 'Group reviewer', cluster_reviewer: 'Cluster reviewer', company_reviewer: 'Company reviewer', company_dpo: 'DPO' };

export function NodeSelect({ value, onChange, companiesOnly, allowEmpty, filter }) {
  const { nodes } = useApp();
  return (
    <select value={value || ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
      {allowEmpty && <option value="">{allowEmpty}</option>}
      {[...nodes.values()].filter((n) => (!companiesOnly || n.type === 'company') && (!filter || filter(n))).map((n) => (
        <option key={n.id} value={n.id}>{companiesOnly ? n.name : `${'    '.repeat(n.depth)}${n.name}`}</option>
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
    <select value={value || periods.last_month} onChange={(e) => onChange(e.target.value)}>
      {periods.months.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
    </select>
  );
}

export const Seg = ({ value, options, onChange }) => (
  <span className="seg">{options.map(([v, l]) => <button key={v} type="button" className={v === value ? 'on' : ''} onClick={() => onChange(v)}>{l}</button>)}</span>
);

export function UnitSelect() {
  const { view, setView } = useApp();
  return <Seg value={view.unit === '1' ? '1' : 'm'} options={[['m', 'Millions'], ['1', 'Full']]} onChange={(u) => setView({ unit: u })} />;
}

export const Num = ({ v, fmt, unit, className = '', title }) => (
  <td className={`n ${className}`} title={title || v == null || fmt === 'percent' ? undefined : fv(v, fmt === 'qty' ? 'qty' : fmt, '1')}>{fv(v, fmt, unit)}</td>
);

export const St = ({ s, reopened, overdue }) => (
  <span className={`st ${overdue ? 'lapsed' : s}`}>
    {s !== 'na' && <i />}{STATUS[s] ?? s}{overdue ? ' · late' : ''}{reopened > 0 && s !== 'reopened' ? <sup title="Reopened earlier">R</sup> : null}
  </span>
);

export function Logo({ node, size = '' }) {
  const src = node?.logo || node?.meta?.logo;
  if (src) return <img className={`logo ${size}`} src={src} alt="" />;
  const ini = (node?.name || '?').split(/\s+/).filter((w) => /^[A-Za-z]/.test(w)).slice(0, 3).map((w) => w[0]).join('').toUpperCase();
  return <span className={`logo ${size}`}>{ini}</span>;
}

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

export function Ask({ title, label, onOk, onClose, okText = 'OK', required = true }) {
  const [v, setV] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={title} onClose={onClose}>
      {label && <label className="f">{label}<textarea rows={3} value={v} onChange={(e) => setV(e.target.value)} autoFocus /></label>}
      <div className="row"><span className="sp" /><button onClick={onClose}>Cancel</button>
        <button className="dark" disabled={busy || (label && required && !v.trim())}
          onClick={async () => { setBusy(true); try { await onOk(v); onClose(); } catch { /* shown */ } finally { setBusy(false); } }}>{okText}</button></div>
    </Modal>
  );
}

// Status + approve / reopen + audit trail for one weekly or monthly report
export function Workflow({ base, status, reopened, actions = [], log = [], onDone }) {
  const { notify, loadInbox } = useApp();
  const [ask, setAsk] = useState(null);
  const [showLog, setShowLog] = useState(false);
  const run = async (action, comment) => {
    try { await api.post(`${base}/${action}`, { comment }); notify(action === 'approve' ? 'Approved' : 'Reopened'); loadInbox(); onDone(); } catch (e) { notify(e.message, 'err'); throw e; }
  };
  return (
    <div className="row" style={{ margin: '4px 0 12px' }}>
      <St s={status} reopened={reopened} />
      {log.length > 0 && <button className="link small" onClick={() => setShowLog(!showLog)}>{showLog ? 'hide trail' : `trail (${log.length})`}</button>}
      <span className="sp" />
      {actions.includes('approve') && <button className="dark" onClick={() => setAsk('approve')}>Approve</button>}
      {actions.includes('reopen') && <button onClick={() => setAsk('reopen')}>Reopen for entry</button>}
      {showLog && (
        <div className="log" style={{ width: '100%' }}>
          {log.map((l, i) => (
            <div key={i}>{l.at.slice(0, 16)} · <b>{ACTION[l.action] || l.action}</b> by {l.name || '—'} ({ROLE[l.role] || l.role}){l.comment ? ` — ${l.comment}` : ''}</div>
          ))}
        </div>
      )}
      {ask === 'approve' && <Ask title="Approve" label="Comment" required={false} okText="Approve" onClose={() => setAsk(null)} onOk={(c) => run('approve', c)} />}
      {ask === 'reopen' && <Ask title="Reopen for entry" label="Reason" okText="Reopen" onClose={() => setAsk(null)} onOk={(c) => run('reopen', c)} />}
    </div>
  );
}

export const Loading = () => <div className="empty">Loading…</div>;

export const PrintButton = () => <button className="noprint" onClick={() => window.print()}>Print / PDF</button>;

// Shown only on paper: logo, profile line, report title, period and print time
export function PrintHeader({ node, title, period }) {
  const { nodes } = useApp();
  const full = nodes.get(node?.id) || node || {};
  const meta = full.meta || {};
  return (
    <div className="print-only print-head">
      <Logo node={full} size="lg" />
      <div>
        <div className="ph-name">{full.name}</div>
        <div className="ph-sub">{[meta.legal_name, meta.entity_type, meta.business_nature].filter(Boolean).join(' · ')}</div>
        <div className="ph-title">{title}{period ? ` — ${period}` : ''}</div>
      </div>
      <div className="ph-time">Printed {new Date().toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
    </div>
  );
}

// month / quarter / year selection with comparative (stored in the shared view)
export const periodQuery = (view, periods) => ({
  mode: view.pmode && view.pmode !== 'week' ? view.pmode : 'month',
  month: view.pmonth || periods?.last_month,
  fy: view.pfy || periods?.current_fy,
  q: view.pq || periods?.current_q,
  cmp: view.pcmp || 'prev',
});

export function PeriodPicker({ mode: forced }) {
  const { view, setView, periods } = useApp();
  if (!periods) return null;
  const q = periodQuery(view, periods);
  const mode = forced || q.mode;
  return (
    <>
      {mode === 'month' && <MonthSelect value={q.month} onChange={(m) => setView({ pmonth: m })} />}
      {mode !== 'month' && (
        <select value={q.fy} onChange={(e) => setView({ pfy: Number(e.target.value) })}>
          {(periods.fys || []).map((f) => <option key={f.fy} value={f.fy}>{f.label}</option>)}
        </select>
      )}
      {mode === 'quarter' && <Seg value={Number(q.q)} options={[1, 2, 3, 4].map((n) => [n, `Q${n}`])} onChange={(n) => setView({ pq: n })} />}
      {mode !== 'year' && <Seg value={q.cmp} options={[['prev', mode === 'month' ? 'vs prev. month' : 'vs prev. quarter'], ['ly', 'vs last year']]} onChange={(c) => setView({ pcmp: c })} />}
    </>
  );
}
