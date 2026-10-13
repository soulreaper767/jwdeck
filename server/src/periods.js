// Period keys: monthly = 'YYYY-MM', weekly = ISO week 'YYYY-Www' (Mon..Sun). All maths in UTC.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY = 86400000;

const pad = (n, w = 2) => String(n).padStart(w, '0');
const ymd = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

function isoWeekInfo(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dow); // Thursday of this week decides the ISO year
  const year = d.getUTCFullYear();
  const week = Math.ceil(((d - Date.UTC(year, 0, 1)) / DAY + 1) / 7);
  return { year, week };
}

function isoWeekMonday(year, week) {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dow = jan4.getUTCDay() || 7;
  return new Date(jan4.getTime() + ((1 - dow) + (week - 1) * 7) * DAY);
}

const weeksInYear = (year) => isoWeekInfo(new Date(Date.UTC(year, 11, 28))).week;

export function isValidKey(freq, key) {
  if (freq === 'monthly') {
    const m = /^(\d{4})-(\d{2})$/.exec(key || '');
    return !!m && +m[2] >= 1 && +m[2] <= 12;
  }
  if (freq === 'weekly') {
    const m = /^(\d{4})-W(\d{2})$/.exec(key || '');
    return !!m && +m[2] >= 1 && +m[2] <= weeksInYear(+m[1]);
  }
  return false;
}

export function keyForDate(freq, date = new Date()) {
  if (freq === 'monthly') return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}`;
  const { year, week } = isoWeekInfo(date);
  return `${year}-W${pad(week)}`;
}

export function bounds(freq, key) {
  if (freq === 'monthly') {
    const [y, m] = key.split('-').map(Number);
    return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 0)) };
  }
  const [y, w] = key.split('-W').map(Number);
  const start = isoWeekMonday(y, w);
  return { start, end: new Date(start.getTime() + 6 * DAY) };
}

export function label(freq, key) {
  if (freq === 'monthly') {
    const [y, m] = key.split('-').map(Number);
    return `${MONTHS[m - 1]} ${y}`;
  }
  const { start, end } = bounds(freq, key);
  const s = `${start.getUTCDate()} ${MONTHS[start.getUTCMonth()]}`;
  const e = `${end.getUTCDate()} ${MONTHS[end.getUTCMonth()]}`;
  return `${key.replace('-', ' ')} (${s}–${e})`;
}

export function shift(freq, key, n) {
  if (freq === 'monthly') {
    const [y, m] = key.split('-').map(Number);
    const idx = y * 12 + (m - 1) + n;
    return `${Math.floor(idx / 12)}-${pad((idx % 12) + 1)}`;
  }
  const { start } = bounds(freq, key);
  return keyForDate('weekly', new Date(start.getTime() + n * 7 * DAY));
}

export const prev = (freq, key) => shift(freq, key, -1);

export function lastYear(freq, key) {
  if (freq === 'monthly') return shift(freq, key, -12);
  const [y, w] = key.split('-W').map(Number);
  return `${y - 1}-W${pad(Math.min(w, weeksInYear(y - 1)))}`;
}

// Last n keys ending at (and including) endKey, oldest first.
export function series(freq, endKey, n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(shift(freq, endKey, -i));
  return out;
}

// Month a period belongs to (for FX): weekly uses the ISO Thursday's month.
export function monthOf(freq, key) {
  if (freq === 'monthly') return key;
  const { start } = bounds(freq, key);
  return keyForDate('monthly', new Date(start.getTime() + 3 * DAY));
}

export function fiscalYearStart(monthKey, fyStartMonth) {
  const [y, m] = monthKey.split('-').map(Number);
  const fyYear = m >= fyStartMonth ? y : y - 1;
  return `${fyYear}-${pad(fyStartMonth)}`;
}

export function fiscalYearLabel(monthKey, fyStartMonth) {
  const start = fiscalYearStart(monthKey, fyStartMonth);
  const y = +start.slice(0, 4);
  return fyStartMonth === 1 ? `FY${y}` : `FY${String(y).slice(2)}-${String(y + 1).slice(2)}`;
}

// Keys covered by a view mode, ending at key. Weekly supports 'period' and 'mtd' (weeks whose month == key's month).
export function rangeKeys(freq, key, mode, fyStartMonth) {
  if (mode === 'period' || !mode) return [key];
  if (freq === 'monthly') {
    if (mode === 'ytd') {
      const start = fiscalYearStart(key, fyStartMonth);
      const out = [];
      for (let k = start; k <= key; k = shift('monthly', k, 1)) out.push(k);
      return out;
    }
    if (mode === 'qtd') {
      const start = fiscalYearStart(key, fyStartMonth);
      const [sy, sm] = start.split('-').map(Number);
      const [y, m] = key.split('-').map(Number);
      const offset = (y * 12 + m) - (sy * 12 + sm);
      const qStart = shift('monthly', start, Math.floor(offset / 3) * 3);
      const out = [];
      for (let k = qStart; k <= key; k = shift('monthly', k, 1)) out.push(k);
      return out;
    }
  }
  if (freq === 'weekly' && mode === 'mtd') {
    const month = monthOf('weekly', key);
    const out = [];
    for (let k = key; monthOf('weekly', k) === month; k = prev('weekly', k)) out.unshift(k);
    return out;
  }
  return [key];
}

export function dueDate(freq, key, dueDays) {
  const { end } = bounds(freq, key);
  return new Date(end.getTime() + Number(dueDays || 0) * DAY);
}

export function describe(freq, key) {
  const { start, end } = bounds(freq, key);
  return { key, label: label(freq, key), start: ymd(start), end: ymd(end) };
}

// Most recent closed period (the one users are normally expected to file).
export function lastClosed(freq, now = new Date()) {
  return prev(freq, keyForDate(freq, now));
}
