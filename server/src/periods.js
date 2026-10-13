// Weeks are ISO weeks (Mon..Sun) keyed 'YYYY-Www'. Months are 'YYYY-MM'.
// A week that crosses a month end is split into two portions (segments), one per month.

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY = 86400000;
const pad = (n) => String(n).padStart(2, '0');

export const ymd = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
export const monthOfDate = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;

function isoWeek(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dow);
  const year = d.getUTCFullYear();
  return { year, week: Math.ceil(((d - Date.UTC(year, 0, 1)) / DAY + 1) / 7) };
}

const weeksInYear = (y) => isoWeek(new Date(Date.UTC(y, 11, 28))).week;

export function weekKey(date = new Date()) {
  const { year, week } = isoWeek(date);
  return `${year}-W${pad(week)}`;
}

export function isWeek(k) {
  const m = /^(\d{4})-W(\d{2})$/.exec(k || '');
  return !!m && +m[2] >= 1 && +m[2] <= weeksInYear(+m[1]);
}
export const isMonth = (k) => /^\d{4}-(0[1-9]|1[0-2])$/.test(k || '');

export function weekStart(k) {
  const [y, w] = k.split('-W').map(Number);
  const jan4 = new Date(Date.UTC(y, 0, 4));
  const dow = jan4.getUTCDay() || 7;
  return new Date(jan4.getTime() + ((1 - dow) + (w - 1) * 7) * DAY);
}
export const weekEnd = (k) => new Date(weekStart(k).getTime() + 6 * DAY);
export const shiftWeek = (k, n) => weekKey(new Date(weekStart(k).getTime() + n * 7 * DAY));
export const lastClosedWeek = (now = new Date()) => shiftWeek(weekKey(now), -1);

export const daysInMonth = (m) => { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo, 0)).getUTCDate(); };
export const monthStart = (m) => { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo - 1, 1)); };
export const monthEnd = (m) => { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo, 0)); };
export const shiftMonth = (m, n) => { const [y, mo] = m.split('-').map(Number); const i = y * 12 + mo - 1 + n; return `${Math.floor(i / 12)}-${pad((i % 12) + 1)}`; };
export const monthLabel = (m) => { const [y, mo] = m.split('-').map(Number); return `${MON[mo - 1]} ${y}`; };

const dm = (d) => `${d.getUTCDate()} ${MON[d.getUTCMonth()]}`;

// Portions of a week, one per calendar month it touches.
export function segments(k) {
  const s = weekStart(k);
  const e = weekEnd(k);
  const out = [];
  let cur = s;
  while (cur <= e) {
    const m = monthOfDate(cur);
    const end = new Date(Math.min(e.getTime(), monthEnd(m).getTime()));
    out.push({
      month: m, start: ymd(cur), end: ymd(end), days: Math.round((end - cur) / DAY) + 1,
      label: cur.getUTCMonth() === end.getUTCMonth() ? `${cur.getUTCDate()}–${dm(end)}` : `${dm(cur)}–${dm(end)}`,
      closes_month: ymd(end) === ymd(monthEnd(m)),
    });
    cur = new Date(end.getTime() + DAY);
  }
  return out;
}

export function weekLabel(k) {
  const s = weekStart(k);
  const e = weekEnd(k);
  const range = s.getUTCMonth() === e.getUTCMonth() ? `${s.getUTCDate()}–${dm(e)}` : `${dm(s)} – ${dm(e)}`;
  return `${k.slice(5)} · ${range} ${e.getUTCFullYear()}`;
}

export function describeWeek(k) {
  return { key: k, label: weekLabel(k), start: ymd(weekStart(k)), end: ymd(weekEnd(k)), segments: segments(k) };
}

// Weeks (in order) that have a portion inside month m
export function monthWeeks(m) {
  const out = [];
  for (let k = weekKey(monthStart(m)); weekStart(k) <= monthEnd(m); k = shiftWeek(k, 1)) out.push(k);
  return out;
}

export function weekRange(from, to) {
  const out = [];
  for (let k = from; k <= to; k = shiftWeek(k, 1)) out.push(k);
  return out;
}

// Days of month m elapsed up to and including date string ymdEnd
export function elapsed(m, ymdEnd) {
  const e = new Date(`${ymdEnd}T00:00:00Z`);
  const s = monthStart(m);
  return Math.max(0, Math.min(daysInMonth(m), Math.round((e - s) / DAY) + 1));
}

export function fyStart(m, startMonth) {
  const [y, mo] = m.split('-').map(Number);
  return `${mo >= startMonth ? y : y - 1}-${pad(startMonth)}`;
}
export function fyMonths(m, startMonth) {
  const out = [];
  for (let k = fyStart(m, startMonth); k <= m; k = shiftMonth(k, 1)) out.push(k);
  return out;
}
export function fyLabel(m, startMonth) {
  const y = +fyStart(m, startMonth).slice(0, 4);
  return startMonth === 1 ? `FY${y}` : `FY${String(y).slice(2)}-${String(y + 1).slice(2)}`;
}
export function fyAllMonths(fy, startMonth) {
  const out = [];
  let k = `${fy}-${pad(startMonth)}`;
  for (let i = 0; i < 12; i++, k = shiftMonth(k, 1)) out.push(k);
  return out;
}

export const dueDate = (k, days) => new Date(weekEnd(k).getTime() + Number(days || 1) * DAY);
