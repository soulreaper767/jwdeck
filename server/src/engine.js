import { db, getSettings, plainAll } from './db.js';
import * as P from './periods.js';
import { buildModel, derive, addv } from './calc.js';

// ------------------------------------------------------------------ tree

export function loadTree() {
  const nodes = plainAll(db.prepare('SELECT * FROM nodes ORDER BY sort, name').all());
  const byId = new Map(nodes.map((n) => [n.id, { ...n, meta: JSON.parse(n.meta || '{}'), children: [] }]));
  const roots = [];
  for (const n of byId.values()) {
    if (n.parent_id && byId.has(n.parent_id)) byId.get(n.parent_id).children.push(n);
    else roots.push(n);
  }
  return { byId, roots };
}

export function companiesUnder(tree, id, { includeInactive = false } = {}) {
  const out = [];
  const walk = (n) => { if (n.type === 'company' && (includeInactive || n.active)) out.push(n); n.children.forEach(walk); };
  const s = tree.byId.get(id);
  if (s) walk(s);
  return out;
}

export function isWithin(tree, ancestorId, nodeId) {
  for (let n = tree.byId.get(nodeId); n; n = tree.byId.get(n.parent_id)) if (n.id === ancestorId) return true;
  return false;
}

export function pathOf(tree, nodeId) {
  const out = [];
  for (let n = tree.byId.get(nodeId); n; n = tree.byId.get(n.parent_id)) out.unshift({ id: n.id, name: n.name, type: n.type });
  return out;
}

const nodeOut = (n, ccy) => ({ id: n.id, name: n.name, type: n.type, code: n.code, currency: ccy || n.currency, logo: n.meta?.logo || null });

// ------------------------------------------------------------------ lines

export function loadLines({ all = false } = {}) {
  return plainAll(db.prepare(`SELECT l.*, p.code AS parent_code FROM lines l LEFT JOIN lines p ON p.id = l.parent_id
    ${all ? '' : 'WHERE l.active = 1'} ORDER BY l.sort, l.id`).all());
}
export const loadSections = () => plainAll(db.prepare('SELECT * FROM sections ORDER BY sort').all());

export const isQty = (item) => /:(PQ|SQ)$/.test(item);
const SKU_PART = { PQ: 'Production', SQ: 'Sales quantity', SV: 'Sales value' };
const MLOCK = new Set(['submitted', 'company_ok', 'cluster_ok', 'approved']);
export function fyOf(month, fyStartMonth) { return Number(P.fyStart(month, fyStartMonth).slice(0, 4)); }

const depthOf = (m, l) => { let n = 0; for (let p = m.byCode.get(l.parent_code); p; p = m.byCode.get(p.parent_code)) n++; return n; };

// ------------------------------------------------------------------ engine

export class Engine {
  constructor() {
    this.settings = getSettings();
    this.fyStartMonth = Number(this.settings.fiscal_year_start_month || 7);
    this.groupCcy = this.settings.group_currency || 'PKR';
    this.tree = loadTree();
    this.sections = loadSections();
    this.lines = loadLines();
    this.m = buildModel(this.lines);
    this.weekInputs = this.lines.filter((l) => l.kind === 'input' && l.scope === 'week').map((l) => l.code);
    this.monthInputs = this.lines.filter((l) => l.kind === 'input' && l.scope === 'month').map((l) => l.code);
    this.skuTotal = this.lines.find((l) => l.kind === 'sku_total')?.code;

    this.skus = new Map();
    for (const s of plainAll(db.prepare('SELECT * FROM skus WHERE active = 1 ORDER BY sort, id').all())) {
      if (!this.skus.has(s.company_id)) this.skus.set(s.company_id, []);
      this.skus.get(s.company_id).push(s);
    }
    this.skuById = new Map([...this.skus.values()].flat().map((s) => [s.id, s]));
    this.setup = new Map(plainAll(db.prepare('SELECT * FROM company_setup').all()).map((s) => [s.company_id, s]));

    const latest = (table, key) => plainAll(db.prepare(`SELECT f.* FROM ${table} f JOIN (SELECT company_id, ${key} k, MAX(revision) r FROM ${table}
      GROUP BY company_id, ${key}) x ON x.company_id = f.company_id AND x.k = f.${key} AND x.r = f.revision`).all());
    this.filings = new Map(latest('filings', 'week_key').map((f) => [`${f.company_id}|${f.week_key}`, { ...JSON.parse(f.data_json), revision: f.revision, filed_at: f.filed_at }]));
    this.mfilings = new Map(latest('month_filings', 'month_key').map((f) => [`${f.company_id}|${f.month_key}`, { ...JSON.parse(f.data_json), revision: f.revision, filed_at: f.filed_at }]));
    const wr = plainAll(db.prepare('SELECT company_id, week_key, status, reopened FROM reports').all());
    this.wstatus = new Map(wr.map((r) => [`${r.company_id}|${r.week_key}`, r.status]));
    this.wreopen = new Map(wr.map((r) => [`${r.company_id}|${r.week_key}`, r.reopened]));
    const mr = plainAll(db.prepare('SELECT company_id, month_key, status, reopened FROM month_reports').all());
    this.mstatus = new Map(mr.map((r) => [`${r.company_id}|${r.month_key}`, r.status]));
    this.mreopen = new Map(mr.map((r) => [`${r.company_id}|${r.month_key}`, r.reopened]));

    this.bAnnual = new Map(plainAll(db.prepare('SELECT * FROM budget_annual').all()).map((b) => [`${b.company_id}|${b.fy}|${b.item}`, b.value]));
    this.bMonth = new Map();
    this.bSpecificSum = new Map();
    for (const b of plainAll(db.prepare('SELECT * FROM budget_month').all())) {
      this.bMonth.set(`${b.company_id}|${b.month_key}|${b.item}`, b.value);
      const k = `${b.company_id}|${fyOf(b.month_key, this.fyStartMonth)}|${b.item}`;
      this.bSpecificSum.set(k, (this.bSpecificSum.get(k) || 0) + b.value);
    }
    this.drafts = new Map();
    this.mdrafts = new Map();
    this._fx = new Map();
    this.fxMissing = new Set();
    this._chains = new Map();
  }

  // ---- items
  skuItems(cid) { return (this.skus.get(cid) || []).flatMap((s) => [`SKU:${s.id}:PQ`, `SKU:${s.id}:SQ`, `SKU:${s.id}:SV`]); }
  items(cid) { return [...this.weekInputs, ...this.skuItems(cid)]; }
  budgetItems(cid) { return [...this.lines.filter((l) => l.budget && l.kind === 'input').map((l) => l.code), ...this.skuItems(cid)]; }
  itemLabel(item) {
    const sk = /^SKU:(\d+):(PQ|SQ|SV)$/.exec(item);
    if (sk) {
      const s = this.skuById.get(Number(sk[1]));
      return s ? `${s.name} – ${SKU_PART[sk[2]].toLowerCase()}${sk[2] !== 'SV' ? ` (${s.unit})` : ''}` : item;
    }
    return this.m.byCode.get(item)?.name || item;
  }

  // ---- item behaviour: flow (adds up), balance (latest value, e.g. pipeline) or flag (Yes/No, counted)
  itemKind(item) {
    const l = this.m.byCode.get(item);
    if (l?.fmt === 'flag') return 'flag';
    if (l?.nature === 'balance') return 'balance';
    return 'flow';
  }
  noFx(item) { return isQty(item) || ['number', 'flag'].includes(this.m.byCode.get(item)?.fmt); }
  // week value of a balance / flag item: last portion entered, or Yes if any portion says Yes
  weekStock(d, w, item, kind) {
    const byM = d?.values?.[item];
    if (!byM) return null;
    if (kind === 'flag') return Object.values(byM).some((v) => v > 0) ? 1 : 0;
    const segs = P.segments(w);
    for (let i = segs.length - 1; i >= 0; i--) if (byM[segs[i].month] != null) return byM[segs[i].month];
    return null;
  }
  // over the weeks of the given months up to W: latest balance, or number of weeks flagged Yes
  stockValue(cid, item, kind, months, W, start, rate) {
    const weeks = [...new Set(months.flatMap((mo) => P.monthWeeks(mo)))].filter((w) => w >= start && w <= W).sort();
    if (kind === 'flag') {
      let n = null;
      for (const w of weeks) { const v = this.weekStock(this.data(cid, w), w, item, kind); if (v != null) n = (n ?? 0) + v; }
      return n;
    }
    for (let i = weeks.length - 1; i >= 0; i--) {
      const w = weeks[i];
      const v = this.weekStock(this.data(cid, w), w, item, kind);
      if (v != null) return v * rate(P.segments(w).at(-1).month);
    }
    return null;
  }

  // ---- data
  data(cid, week) {
    const k = `${cid}|${week}`;
    return this.drafts.has(k) ? this.drafts.get(k) : this.filings.get(k) || null;
  }
  setDraft(cid, week, d) { this.drafts.set(`${cid}|${week}`, d); this._chains.delete(cid); }
  mdata(cid, month) {
    const k = `${cid}|${month}`;
    return this.mdrafts.has(k) ? this.mdrafts.get(k) : this.mfilings.get(k) || null;
  }
  setMonthDraft(cid, month, d) { this.mdrafts.set(`${cid}|${month}`, d); }
  // Entry closes at the cut-off (following Monday 11:00 local) — except weeks that end a month,
  // which stay open until that month's close is submitted.
  cutoff(w) {
    const hour = Number(this.settings.week_cutoff_hour ?? 11);
    const tz = Number(this.settings.tz_offset_hours ?? 5);
    return P.dueDate(w, this.settings.week_due_days).getTime() + (hour - tz) * 3600000;
  }
  isMonthEndWeek(w) { return P.segments(w).some((s) => s.closes_month); }
  weekStatus(cid, w) {
    const s = this.setup.get(cid);
    if (!s || w < s.start_week) return 'na';
    const st = this.wstatus.get(`${cid}|${w}`) || 'new';
    if (st !== 'new' && st !== 'draft') return st;
    if (this.isMonthEndWeek(w)) {
      const closed = P.segments(w).filter((x) => x.closes_month).some((x) => MLOCK.has(this.mstatus.get(`${cid}|${x.month}`)));
      return closed ? 'lapsed' : st;
    }
    return Date.now() > this.cutoff(w) ? 'lapsed' : st;
  }
  // submitted at some point, or lapsed (counts as reported with no figures)
  weekDone(cid, w) { return this.filings.has(`${cid}|${w}`) || this.weekStatus(cid, w) === 'lapsed'; }
  monthStatus(cid, m) {
    const s = this.setup.get(cid);
    if (!s || P.monthWeeks(m).every((w) => w < s.start_week)) return 'na';
    return this.mstatus.get(`${cid}|${m}`) || 'new';
  }
  // all weeks of the month (from company start) submitted at least once
  monthReady(cid, m) {
    const s = this.setup.get(cid);
    if (!s) return false;
    const now = Date.now();
    if (now < P.monthEnd(m).getTime() + 86400000) return false;
    return P.monthWeeks(m).filter((w) => w >= s.start_week).every((w) => this.weekDone(cid, w));
  }

  // ---- budgets: specific(month) + (annual − Σ specific in FY) spread by days
  budget(cid, month, item) {
    const fy = fyOf(month, this.fyStartMonth);
    const annual = this.bAnnual.get(`${cid}|${fy}|${item}`);
    const spec = this.bMonth.get(`${cid}|${month}|${item}`);
    if (annual == null && spec == null) return null;
    let v = spec || 0;
    if (annual != null) {
      const rest = annual - (this.bSpecificSum.get(`${cid}|${fy}|${item}`) || 0);
      const fyDays = P.fyAllMonths(fy, this.fyStartMonth).reduce((a, mo) => a + P.daysInMonth(mo), 0);
      v += (rest * P.daysInMonth(month)) / fyDays;
    }
    return v;
  }

  fx(ccy, month) {
    if (!ccy || ccy === this.groupCcy) return 1;
    const k = `${ccy}|${month}`;
    if (!this._fx.has(k)) {
      const r = db.prepare('SELECT rate FROM fx_rates WHERE currency = ? AND month_key <= ? ORDER BY month_key DESC LIMIT 1').get(ccy, month);
      if (!r) this.fxMissing.add(`${ccy} ${month}`);
      this._fx.set(k, r ? r.rate : 1);
    }
    return this._fx.get(k);
  }

  portionBase(d, week, month, withAdj) {
    const base = {};
    if (!d) return base;
    for (const [item, byM] of Object.entries(d.values || {})) if (byM[month] != null) base[item] = byM[month];
    if (withAdj && P.segments(week)[0].month === month) {
      for (const [item, a] of Object.entries(d.adj || {})) base[item] = addv(base[item] ?? null, a.value);
    }
    return base;
  }

  // Cash roll-forward: opening/closing for every week portion from the company's start week
  chain(cid) {
    if (this._chains.has(cid)) return this._chains.get(cid);
    const setup = this.setup.get(cid);
    const map = new Map();
    if (setup) {
      let lastWeek = P.weekKey();
      for (const k of this.drafts.keys()) if (k.startsWith(`${cid}|`) && k.split('|')[1] > lastWeek) lastWeek = k.split('|')[1];
      let run = setup.opening_cash;
      for (const w of P.weekRange(setup.start_week, lastWeek)) {
        const d = this.data(cid, w);
        for (const s of P.segments(w)) {
          const open = run;
          if (d) {
            const base = this.portionBase(d, w, s.month, true);
            base[this.m.openingCode] = 0;
            run += derive(this.m, base)[this.m.closingCode] || 0;
          }
          map.set(`${w}|${s.month}`, { open, close: run });
        }
      }
    }
    this._chains.set(cid, map);
    return map;
  }

  // Month-to-date actual for a weekly item in month mo, weeks up to W (incl. adjustments booked in mo)
  monthActual(cid, mo, W, item, start) {
    let v = null;
    for (const w of P.monthWeeks(mo)) {
      if (w > W || w < start) continue;
      const d = this.data(cid, w);
      if (!d) continue;
      v = addv(v, d.values?.[item]?.[mo] ?? null);
      if (P.segments(w)[0].month === mo && d.adj?.[item]) v = addv(v, d.adj[item].value);
    }
    return v;
  }

  firstOpen(cid, mo, start, W) {
    const w = P.monthWeeks(mo).find((x) => x >= start);
    return w && w <= W ? this.chain(cid).get(`${w}|${mo}`)?.open ?? null : null;
  }

  addSkuTotal(vec) {
    if (!this.skuTotal || !vec) return;
    let t = null;
    for (const [k, v] of Object.entries(vec)) if (k.endsWith(':SV')) t = addv(t, v);
    if (t != null) vec[this.skuTotal] = t;
  }

  collapseKey(item) {
    if (!item.startsWith('SKU:')) return item;
    const [, id, part] = item.split(':');
    if (part === 'SV') return null;
    return `UNIT:${part}:${this.skuById.get(Number(id))?.unit || 'units'}`;
  }

  sumVecs(list, collapse) {
    const out = {};
    for (const V of list) {
      for (const [vn, vec] of Object.entries(V)) {
        out[vn] ||= {};
        for (const [item, v] of Object.entries(vec || {})) {
          const key = collapse ? this.collapseKey(item) : item;
          if (key) out[vn][key] = addv(out[vn][key] ?? null, v);
          // company level keeps SKU lines and also gets quantity totals per unit
          if (!collapse && item.startsWith('SKU:')) {
            const uk = this.collapseKey(item);
            if (uk) out[vn][uk] = addv(out[vn][uk] ?? null, v);
          }
          // grand totals of quantity across all units
          const part = /^SKU:[0-9]+:(PQ|SQ)$/.exec(item)?.[1];
          if (part) out[vn][`ALL:${part}`] = addv(out[vn][`ALL:${part}`] ?? null, v);
        }
      }
    }
    return out;
  }

  sectionsFor(scope, mk, companyId, D) {
    const secs = this.sections.filter((s) => !scope || s.scope === scope).map((s) => ({ code: s.code, name: s.name, scope: s.scope, rows: [] }));
    for (const l of this.m.list) {
      const s = secs.find((x) => x.code === l.section);
      if (s) s.rows.push(mk(l.code, l.name, { fmt: l.fmt === 'flag' && !companyId ? 'count' : l.fmt, hib: l.hib, depth: depthOf(this.m, l), nature: l.nature, scope: l.scope, stock: l.nature === 'balance' || l.fmt === 'flag', strong: ['sum', 'formula', 'cfnet'].includes(l.kind) }));
    }
    const ps = secs.find((s) => s.code === 'PRODSALES');
    if (ps) {
      if (companyId) {
        for (const s of this.skus.get(companyId) || []) {
          ps.rows.push({ group: true, name: s.name, unit: s.unit });
          ps.rows.push(mk(`SKU:${s.id}:PQ`, `Production (${s.unit})`, { fmt: 'qty', depth: 1 }));
          ps.rows.push(mk(`SKU:${s.id}:SQ`, `Sales (${s.unit})`, { fmt: 'qty', depth: 1 }));
          ps.rows.push(mk(`SKU:${s.id}:SV`, 'Sales value', { depth: 1 }));
        }
        const units = [...new Set((this.skus.get(companyId) || []).map((s) => s.unit))];
        for (const u of units) ps.rows.push({ ...mk(`UNIT:PQ:${u}`, `Total production (${u})`, { fmt: 'qty' }), strong: true });
        for (const u of units) ps.rows.push({ ...mk(`UNIT:SQ:${u}`, `Total sales (${u})`, { fmt: 'qty' }), strong: true });
      } else {
        const units = new Set(D.flatMap((x) => Object.keys(x)).filter((k) => k.startsWith('UNIT:')).map((k) => k.split(':')[2]));
        for (const u of [...units].sort()) {
          ps.rows.push({ ...mk(`UNIT:PQ:${u}`, `Total production (${u})`, { fmt: 'qty' }), strong: true });
          ps.rows.push({ ...mk(`UNIT:SQ:${u}`, `Total sales (${u})`, { fmt: 'qty' }), strong: true });
        }
      }
      ps.rows.push({ ...mk('ALL:PQ', 'Grand total production (all units)', { fmt: 'qty' }), strong: true, grand: true });
      ps.rows.push({ ...mk('ALL:SQ', 'Grand total sales (all units)', { fmt: 'qty' }), strong: true, grand: true });
      if (this.skuTotal) ps.rows.push({ ...mk(this.skuTotal, 'Total sales value'), strong: true, grand: true });
    }
    return secs;
  }

  coverage(status) {
    const started = status.filter((s) => s.status !== 'na');
    const by = {};
    for (const s of started) by[s.status] = (by[s.status] || 0) + 1;
    return { companies: status.length, started: started.length, filed: status.filter((s) => s.filed).length, by, status };
  }

  childSummaries(node, view) {
    return node.children.filter((c) => c.active && companiesUnder(this.tree, c.id).length).map((c) => {
      const v = view(c.id);
      const flat = {};
      for (const s of v.sections) for (const r of s.rows) if (r.code && !r.code.startsWith('UNIT:')) flat[r.code] = r;
      return { ...nodeOut(c), rows: flat, coverage: v.coverage, status: c.type === 'company' ? v.coverage.status[0]?.status : null, reopened: c.type === 'company' ? v.coverage.status[0]?.reopened : 0 };
    });
  }

  // ================================================================ WEEK

  companyVectors(c, W, M, translate) {
    const setup = this.setup.get(c.id);
    if (!setup || W < setup.start_week) return null;
    const segs = P.segments(W);
    const mseg = segs.find((s) => s.month === M) || segs[segs.length - 1];
    M = mseg.month;
    const rate = (mo) => (translate ? this.fx(c.currency, mo) : 1);
    const rr = (item, mo) => (this.noFx(item) ? 1 : rate(mo));
    const d = this.data(c.id, W);
    const start = setup.start_week;
    const mweeks = P.monthWeeks(M).filter((w) => w >= start && w <= W);
    const fyMonths = P.fyMonths(M, this.fyStartMonth);
    const prevW = [...mweeks].reverse().find((w) => w < W && this.data(c.id, w));
    const prevD = prevW ? this.data(c.id, prevW) : null;
    const adjMonth = segs[0].month;

    const V = { wkA: {}, wkT: {}, adjW: {}, mtdA: {}, mtdT: {}, ytdA: {}, ytdT: {}, prev: {}, thisWk: {} };
    for (const item of this.items(c.id)) {
      const kind = this.itemKind(item);
      if (kind !== 'flow') {
        const r = (mo) => (this.noFx(item) ? 1 : rate(mo));
        const wk = this.weekStock(d, W, item, kind);
        if (wk != null) V.wkA[item] = wk * r(segs.at(-1).month);
        const m = this.stockValue(c.id, item, kind, [M], W, start, r);
        if (m != null) V.mtdA[item] = m;
        const y = this.stockValue(c.id, item, kind, fyMonths, W, start, r);
        if (y != null) V.ytdA[item] = y;
        continue;
      }
      for (const s of segs) {
        V.wkA[item] = addv(V.wkA[item] ?? null, d?.values?.[item]?.[s.month] != null ? d.values[item][s.month] * rr(item, s.month) : null);
        const b = this.budget(c.id, s.month, item);
        if (b != null) V.wkT[item] = addv(V.wkT[item] ?? null, (b * s.days / P.daysInMonth(s.month)) * rr(item, s.month));
      }
      if (d?.adj?.[item]) V.adjW[item] = d.adj[item].value * rr(item, adjMonth);
      const tw = d?.values?.[item]?.[M];
      if (tw != null) V.thisWk[item] = tw * rr(item, M);
      const ma = this.monthActual(c.id, M, W, item, start);
      if (ma != null) V.mtdA[item] = ma * rr(item, M);
      const bm = this.budget(c.id, M, item);
      if (bm != null) V.mtdT[item] = (bm * P.elapsed(M, mseg.end) / P.daysInMonth(M)) * rr(item, M);
      const pr = prevD?.reported?.[M]?.[item];
      if (pr != null) V.prev[item] = pr * rr(item, M);
      let ya = V.mtdA[item] ?? null;
      let yt = V.mtdT[item] ?? null;
      for (const mo of fyMonths) {
        if (mo >= M) continue;
        const a = this.monthActual(c.id, mo, W, item, start);
        if (a != null) ya = addv(ya, a * rr(item, mo));
        const b = this.budget(c.id, mo, item);
        if (b != null) yt = addv(yt, b * rr(item, mo));
      }
      if (ya != null) V.ytdA[item] = ya;
      if (yt != null) V.ytdT[item] = yt;
    }
    Object.values(V).forEach((v) => this.addSkuTotal(v));
    const ch = this.chain(c.id);
    const oc = this.m.openingCode;
    const wkOpen = ch.get(`${W}|${segs[0].month}`)?.open;
    const mOpen = this.firstOpen(c.id, M, start, W);
    const fyOpen = fyMonths.map((mo) => this.firstOpen(c.id, mo, start, W)).find((x) => x != null);
    if (wkOpen != null) V.wkA[oc] = V.wkT[oc] = wkOpen * rate(segs[0].month);
    if (mOpen != null) V.mtdA[oc] = V.mtdT[oc] = V.prev[oc] = mOpen * rate(M);
    if (fyOpen != null) V.ytdA[oc] = V.ytdT[oc] = fyOpen * rate(fyMonths[0]);
    const lastSeg = segs[segs.length - 1];
    const cl = (e, mo) => (e?.close != null ? e.close * rate(mo) : null);
    const closing = { wk: cl(ch.get(`${W}|${lastSeg.month}`), lastSeg.month), mtd: cl(ch.get(`${W}|${M}`), M) };
    closing.ytd = closing.mtd;

    return {
      V, closing, filed: !!d,
      adjList: Object.entries(d?.adj || {}).map(([item, a]) => ({ item, label: this.itemLabel(item), value: a.value, reason: a.reason })),
    };
  }

  weekRows(V, closing, companyId) {
    const D = {};
    for (const vn of ['wkA', 'wkT', 'adjW', 'mtdA', 'mtdT', 'ytdA', 'ytdT', 'prev', 'thisWk']) {
      const vec = V[vn] || {};
      if (vn === 'adjW') { const b = { ...vec }; delete b[this.m.openingCode]; D[vn] = { ...vec, ...derive(this.m, b) }; continue; }
      D[vn] = { ...vec, ...derive(this.m, vec) };
    }
    const cc = this.m.closingCode;
    if (closing.wk != null) D.wkA[cc] = closing.wk;
    if (closing.mtd != null) D.mtdA[cc] = closing.mtd;
    if (closing.ytd != null) D.ytdA[cc] = closing.ytd;
    const mk = (code, name, extra = {}) => {
      const pct = extra.fmt === 'percent' || extra.fmt === 'flag' || extra.nature === 'balance' || (extra.fmt === 'number' && extra.stock);
      const opening = extra.nature === 'opening';
      const prev = D.prev[code] ?? null;
      const tw = D.thisWk[code] ?? null;
      const now = D.mtdA[code] ?? null;
      const recon = !pct && !opening && (prev != null || tw != null || now != null);
      let diff = recon ? (now ?? 0) - ((prev ?? 0) + (tw ?? 0)) : null;
      if (diff != null && Math.abs(diff) < 0.5) diff = 0;
      return {
        code, name, fmt: 'amount', hib: 1, depth: 0, ...extra,
        wk: { t: D.wkT[code] ?? null, a: D.wkA[code] ?? null },
        mtd: { t: D.mtdT[code] ?? null, a: now },
        ytd: { t: D.ytdT[code] ?? null, a: D.ytdA[code] ?? null },
        adj: opening ? null : D.adjW[code] ?? null,
        prev: recon ? prev : null, this: recon ? tw : null, diff,
      };
    };
    return this.sectionsFor('week', mk, companyId, [D.wkA, D.mtdA, D.ytdA]);
  }

  weekView(nodeId, W, M, { children = true } = {}) {
    const node = this.tree.byId.get(nodeId);
    const isCo = node.type === 'company';
    const segs = P.segments(W);
    if (!M || !segs.some((s) => s.month === M)) M = segs[segs.length - 1].month;
    const cvs = [];
    const status = [];
    const adjustments = [];
    const closing = { wk: null, mtd: null, ytd: null };
    for (const c of companiesUnder(this.tree, nodeId)) {
      const cv = this.companyVectors(c, W, M, !isCo);
      status.push({ id: c.id, name: c.name, status: this.weekStatus(c.id, W), reopened: this.wreopen.get(`${c.id}|${W}`) || 0, filed: !!cv?.filed });
      if (!cv) continue;
      cvs.push(cv.V);
      for (const k of ['wk', 'mtd', 'ytd']) closing[k] = addv(closing[k], cv.closing[k]);
      cv.adjList.forEach((a) => adjustments.push({ ...a, company: c.name }));
    }
    const out = {
      node: nodeOut(node, isCo ? node.currency : this.groupCcy),
      week: P.describeWeek(W), month: M, month_label: P.monthLabel(M), fy_label: P.fyLabel(M, this.fyStartMonth),
      sections: this.weekRows(this.sumVecs(cvs, !isCo), closing, isCo ? node.id : null),
      coverage: this.coverage(status),
      adjustments,
    };
    if (children && !isCo) out.children = this.childSummaries(node, (id) => this.weekView(id, W, M, { children: false }));
    return out;
  }

  // ================================================================ MONTH

  companyMonth(c, M, upto, cols, translate) {
    const setup = this.setup.get(c.id);
    if (!setup) return null;
    const start = setup.start_week;
    if (P.monthWeeks(M).every((w) => w < start)) return null;
    const rate = (mo) => (translate ? this.fx(c.currency, mo) : 1);
    const rr = (item, mo) => (this.noFx(item) ? 1 : rate(mo));
    const allW = P.monthWeeks(M).filter((w) => w >= start);
    const dataW = allW.filter((w) => w <= upto && this.data(c.id, w));
    const lastEnd = dataW.length ? P.segments(dataW[dataW.length - 1]).find((s) => s.month === M).end : null;
    const complete = allW.every((w) => w <= upto && this.data(c.id, w));
    const frac = complete ? 1 : lastEnd ? P.elapsed(M, lastEnd) / P.daysInMonth(M) : 0;
    const fyMonths = P.fyMonths(M, this.fyStartMonth);

    const V = { mA: {}, mB: {}, yA: {}, yB: {}, adj: {} };
    const C = cols.map(() => ({}));
    const put = (vec, k, v) => { if (v != null) vec[k] = addv(vec[k] ?? null, v); };
    for (const item of this.items(c.id)) {
      const kind = this.itemKind(item);
      if (kind !== 'flow') {
        const r = (mo) => (this.noFx(item) ? 1 : rate(mo));
        put(V.mA, item, this.stockValue(c.id, item, kind, [M], upto, start, r));
        put(V.yA, item, this.stockValue(c.id, item, kind, fyMonths, upto, start, r));
        cols.forEach(({ week }, i) => {
          if (week < start) return;
          const v = this.data(c.id, week)?.values?.[item]?.[M];
          if (v != null) C[i][item] = v * r(M);
        });
        continue;
      }
      const ma = this.monthActual(c.id, M, upto, item, start);
      put(V.mA, item, ma != null ? ma * rr(item, M) : null);
      const b = this.budget(c.id, M, item);
      put(V.mB, item, b != null ? b * frac * rr(item, M) : null);
      put(V.yA, item, V.mA[item]);
      put(V.yB, item, V.mB[item]);
      for (const mo of fyMonths) {
        if (mo >= M) continue;
        const a = this.monthActual(c.id, mo, upto, item, start);
        put(V.yA, item, a != null ? a * rr(item, mo) : null);
        const bb = this.budget(c.id, mo, item);
        put(V.yB, item, bb != null ? bb * rr(item, mo) : null);
      }
      cols.forEach(({ week }, i) => {
        if (week < start) return;
        const v = this.data(c.id, week)?.values?.[item]?.[M];
        if (v != null) C[i][item] = v * rr(item, M);
      });
      for (const w of allW) {
        if (w > upto || P.segments(w)[0].month !== M) continue;
        const a = this.data(c.id, w)?.adj?.[item];
        if (a) put(V.adj, item, a.value * rr(item, M));
      }
    }
    // P&L lines are like-for-like: budget counts only for months the company has closed
    const hasM = (mo) => !!this.mdata(c.id, mo);
    for (const item of this.monthInputs) {
      const v = this.mdata(c.id, M)?.values?.[item];
      put(V.mA, item, v != null ? v * rate(M) : null);
      const b = hasM(M) ? this.budget(c.id, M, item) : null;
      put(V.mB, item, b != null ? b * rate(M) : null);
      put(V.yA, item, V.mA[item]);
      put(V.yB, item, V.mB[item]);
      for (const mo of fyMonths) {
        if (mo >= M || !hasM(mo)) continue;
        const a = this.mdata(c.id, mo)?.values?.[item];
        put(V.yA, item, a != null ? a * rate(mo) : null);
        const bb = this.budget(c.id, mo, item);
        put(V.yB, item, bb != null ? bb * rate(mo) : null);
      }
    }
    Object.values(V).forEach((v) => this.addSkuTotal(v));
    C.forEach((v) => this.addSkuTotal(v));
    // Link lines (e.g. P&L net revenue) pick up a weekly total only where month figures exist, so P&L stays like-for-like
    for (const l of this.lines.filter((x) => x.kind === 'link')) {
      const src = (vec) => derive(this.m, vec)[l.formula] ?? null;
      const monthVec = (mo) => {
        const v = {};
        for (const item of this.items(c.id)) { const a = this.monthActual(c.id, mo, upto, item, start); if (a != null) v[item] = a * rr(item, mo); }
        this.addSkuTotal(v);
        return v;
      };
      const budVec = (mo) => {
        const v = {};
        for (const item of this.items(c.id)) { const b = this.budget(c.id, mo, item); if (b != null) v[item] = b * rr(item, mo); }
        this.addSkuTotal(v);
        return v;
      };
      for (const mo of fyMonths) {
        if (mo > M || !this.mdata(c.id, mo)) continue;
        put(V.yA, l.code, mo === M ? src(V.mA) : src(monthVec(mo)));
        put(V.yB, l.code, src(budVec(mo)));
        if (mo === M) { put(V.mA, l.code, src(V.mA)); put(V.mB, l.code, src(budVec(mo))); }
      }
    }
    const oc = this.m.openingCode;
    const mOpen = this.firstOpen(c.id, M, start, upto);
    const fyOpen = fyMonths.map((mo) => this.firstOpen(c.id, mo, start, upto)).find((x) => x != null);
    if (mOpen != null) V.mA[oc] = V.mB[oc] = mOpen * rate(M);
    if (fyOpen != null) V.yA[oc] = V.yB[oc] = fyOpen * rate(fyMonths[0]);
    const ch = this.chain(c.id);
    const colOpen = cols.map(({ week }) => (week >= start ? ch.get(`${week}|${M}`)?.open ?? null : null));
    const colClose = cols.map(({ week }) => (week >= start && this.data(c.id, week) ? ch.get(`${week}|${M}`)?.close ?? null : null));
    return {
      V, C, complete, lastEnd,
      colOpen: colOpen.map((x) => (x == null ? null : x * rate(M))),
      colClose: colClose.map((x) => (x == null ? null : x * rate(M))),
    };
  }

  monthView(nodeId, M, upto, { children = true } = {}) {
    const node = this.tree.byId.get(nodeId);
    const isCo = node.type === 'company';
    const cols = P.monthWeeks(M).filter((w) => w <= upto).map((w) => ({ week: w, seg: P.segments(w).find((s) => s.month === M) }));
    const list = [];
    const status = [];
    let lastEnd = null;
    let complete = true;
    for (const c of companiesUnder(this.tree, nodeId)) {
      const cm = this.companyMonth(c, M, upto, cols, !isCo);
      status.push({ id: c.id, name: c.name, status: this.monthStatus(c.id, M), reopened: this.mreopen.get(`${c.id}|${M}`) || 0, filed: !!this.mdata(c.id, M), ready: this.monthReady(c.id, M) });
      if (!cm) continue;
      list.push(cm);
      if (cm.lastEnd && (!lastEnd || cm.lastEnd > lastEnd)) lastEnd = cm.lastEnd;
      if (!cm.complete) complete = false;
    }
    const V = this.sumVecs(list.map((x) => x.V), !isCo);
    const C = cols.map((_, i) => this.sumVecs(list.map((x) => ({ v: x.C[i] })), !isCo).v || {});
    const sumArr = (k, i) => list.reduce((a, x) => addv(a, x[k][i]), null);
    const oc = this.m.openingCode;
    const cc = this.m.closingCode;
    const D = {};
    for (const vn of ['mA', 'mB', 'yA', 'yB']) D[vn] = { ...(V[vn] || {}), ...derive(this.m, V[vn] || {}) };
    { const b = { ...(V.adj || {}) }; delete b[oc]; D.adj = { ...b, ...derive(this.m, b) }; }
    const DC = C.map((vec, i) => {
      const v = { ...vec };
      const o = sumArr('colOpen', i);
      if (o != null) v[oc] = o;
      const dv = { ...v, ...derive(this.m, v) };
      const cl = sumArr('colClose', i);
      if (cl != null) dv[cc] = cl;
      return dv;
    });
    const mk = (code, name, extra = {}) => {
      const weekly = extra.scope !== 'month';
      return {
        code, name, fmt: 'amount', hib: 1, depth: 0, ...extra,
        m: { b: D.mB[code] ?? null, a: D.mA[code] ?? null },
        y: { b: D.yB[code] ?? null, a: D.yA[code] ?? null },
        adj: extra.nature === 'opening' || !weekly ? null : D.adj[code] ?? null,
        cols: DC.map((x) => (weekly ? x[code] ?? null : null)),
      };
    };
    const out = {
      node: nodeOut(node, isCo ? node.currency : this.groupCcy),
      month: M, month_label: P.monthLabel(M), fy_label: P.fyLabel(M, this.fyStartMonth),
      complete, through: lastEnd,
      columns: cols.map(({ week, seg }) => ({ week, label: seg.label, days: seg.days })),
      sections: this.sectionsFor(null, mk, isCo ? node.id : null, [D.mA, D.yA]),
      coverage: this.coverage(status),
    };
    if (children && !isCo) out.children = this.childSummaries(node, (id) => this.monthView(id, M, upto, { children: false }));
    return out;
  }
}
