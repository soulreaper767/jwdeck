export const SCALES = {
  auto: { label: 'Auto', div: null },
  '1': { label: 'Units', div: 1, suffix: '' },
  K: { label: "'000", div: 1e3, suffix: 'K' },
  M: { label: 'Millions', div: 1e6, suffix: 'M' },
  B: { label: 'Billions', div: 1e9, suffix: 'B' },
};

const nf = (d) => new Intl.NumberFormat('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

// Format a head/line value. fmt: amount | percent | number
export function fmtVal(v, fmt = 'amount', scale = 'M', { compact = false } = {}) {
  if (v == null || Number.isNaN(v)) return '–';
  if (fmt === 'percent') return `${nf(1).format(v)}%`;
  if (fmt === 'number') return nf(0).format(v);
  let s = scale;
  if (s === 'auto') {
    const a = Math.abs(v);
    s = a >= 1e9 ? 'B' : a >= 1e6 ? 'M' : a >= 1e3 ? 'K' : '1';
  }
  const { div, suffix } = SCALES[s];
  const x = v / div;
  const digits = s === '1' ? 0 : Math.abs(x) >= 100 ? 1 : 2;
  const str = nf(compact ? (Math.abs(x) >= 100 ? 0 : 1) : digits).format(Math.abs(x));
  const out = `${str}${compact || scale === 'auto' ? suffix : ''}`;
  return v < 0 ? `(${out})` : out;
}

export const fmtPlain = (v, d = 0) => (v == null || v === '' ? '' : nf(d).format(v));

// Variance between cur and base. Returns { pct, cls, text }
export function variance(cur, base, higherIsBetter = 1, fmt = 'amount') {
  if (cur == null || base == null) return { text: '', cls: 'flat', pct: null };
  if (fmt === 'percent') {
    const d = cur - base;
    const cls = Math.abs(d) < 0.05 ? 'flat' : (d > 0) === !!higherIsBetter ? 'good' : 'bad';
    return { text: `${d > 0 ? '+' : ''}${nf(1).format(d)}pp`, cls, pct: d };
  }
  if (base === 0) return { text: cur === 0 ? '0%' : 'n/m', cls: 'flat', pct: null };
  const pct = ((cur - base) / Math.abs(base)) * 100;
  const cls = Math.abs(pct) < 0.5 ? 'flat' : (pct > 0) === !!higherIsBetter ? 'good' : 'bad';
  const arrow = pct > 0 ? '▲' : pct < 0 ? '▼' : '';
  return { text: `${arrow} ${nf(1).format(Math.abs(pct))}%`, cls, pct };
}

export const STATUS_LABEL = { filed: 'Filed', draft: 'Draft', reopened: 'Reopened', missing: 'Not filed', new: 'Not started' };

export function toCSV(rows) {
  return rows.map((r) => r.map((c) => {
    const s = c == null ? '' : String(c);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\n');
}

export function download(name, text, type = 'text/csv') {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
