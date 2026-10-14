export const UNITS = { m: { label: 'PKR millions', div: 1e6, dp: 2 }, '1': { label: 'PKR', div: 1, dp: 0 } };

const nf = (d) => new Intl.NumberFormat('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

// fmt: amount | percent | qty
export function fv(v, fmt = 'amount', unit = 'm') {
  if (v == null || Number.isNaN(v)) return '';
  if (fmt === 'percent') return `${nf(1).format(v)}%`;
  if (fmt === 'flag') return v > 0 ? 'Yes' : 'No';
  if (fmt === 'number' || fmt === 'count') return nf(0).format(v);
  if (fmt === 'qty') { const s = nf(Math.abs(v) < 100 && v % 1 ? 1 : 0).format(Math.abs(v)); return v < 0 ? `(${s})` : s; }
  const u = UNITS[unit] || UNITS.m;
  const s = nf(u.dp).format(Math.abs(v / u.div));
  if (s === nf(u.dp).format(0)) return '–';
  return v < 0 ? `(${s})` : s;
}

// variance of actual vs target → { d, pct, cls }
export function vr(a, t, hib = 1, fmt = 'amount') {
  if (a == null || t == null) return { d: null, pct: null, cls: '' };
  const d = a - t;
  const pct = fmt === 'percent' || t === 0 ? null : (d / Math.abs(t)) * 100;
  const good = hib ? d >= 0 : d <= 0;
  const tiny = fmt === 'percent' ? Math.abs(d) < 0.05 : Math.abs(pct ?? 0) < 0.5 && Math.abs(d) < 1;
  return { d, pct, cls: tiny ? '' : good ? 'good' : 'bad' };
}
export const fpct = (p) => (p == null ? '' : `${p > 0 ? '+' : ''}${nf(1).format(p)}%`);

export const parseNum = (s) => {
  if (s == null) return null;
  let t = String(s).trim().replace(/,/g, '');
  if (!t) return null;
  let neg = false;
  if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
  const n = Number(t);
  if (Number.isNaN(n)) return NaN;
  return neg ? -n : n;
};
export const plainNum = (v) => (v == null ? '' : nf(Math.abs(v % 1) > 0 ? 2 : 0).format(v));

export function toCSV(rows) {
  return rows.map((r) => r.map((c) => { const s = c == null ? '' : String(c); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',')).join('\n');
}
export function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  a.download = name;
  a.click();
}

export const STATUS = { filed: 'Filed', draft: 'Draft', reopened: 'Reopened', missing: 'Not filed', new: 'Not started', na: '' };
