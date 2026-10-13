import { db, getSettings, plainAll } from './db.js';
import * as P from './periods.js';
import { buildModel, derive, addv } from './calc.js';

// ------------------------------------------------------------------ tree

export function loadTree() {
  const nodes = plainAll(db.prepare('SELECT * FROM nodes ORDER BY sort, name').all());
  const byId = new Map(nodes.map((n) => [n.id, { ...n, children: [] }]));
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

// ------------------------------------------------------------------ lines & items

export function loadLines({ all = false } = {}) {
  return plainAll(db.prepare(`SELECT l.*, p.code AS parent_code FROM lines l LEFT JOIN lines p ON p.id = l.parent_id
    ${all ? '' : 'WHERE l.active = 1'} ORDER BY l.sort, l.id`).all());
}
export const loadSections = () => plainAll(db.prepare('SELECT * FROM sections ORDER BY sort').all());

export const isQty = (item) => /:(PQ|SQ)$/.test(item);
const SKU_PART = { PQ: 'Production', SQ: 'Sales quantity', SV: 'Sales value' };

export function fyOf(month, fyStartMonth) { return Number(P.fyStart(month, fyStartMonth).slice(0, 4)); }

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
    this.inputCodes = this.lines.filter((l) => l.kind === 'input').map((l) => l.code);

    this.skus = new Map();
    for (const s of plainAll(db.prepare('SELECT * FROM skus WHERE active = 1 ORDER BY sort, id').all())) {
      if (!this.skus.has(s.company_id)) this.skus.set(s.company_id, []);
      this.skus.get(s.company_id).push(s);
    }
    this.setup = new Map(plainAll(db.prepare('SELECT * FROM company_setup').all()).map((s) => [s.company_id, s]));

    this.filings = new Map();
    for (const f of plainAll(db.prepare(`SELECT f.* FROM filings f JOIN (SELECT company_id, week_key, MAX(revision) r FROM filings
      GROUP BY company_id, week_key) x ON x.company_id = f.company_id AND x.week_key = f.week_key AND x.r = f.revision`).all())) {
      this.filings.set(`${f.company_id}|${f.week_key}`, { ...JSON.parse(f.data_json), revision: f.revision, filed_at: f.filed_at, currency: f.currency });
    }
    this.bAnnual = new Map(plainAll(db.prepare('SELECT * FROM budget_annual').all()).map((b) => [`${b.company_id}|${b.fy}|${b.item}`, b.value]));
    this.bMonth = new Map();
    this.bSpecificSum = new Map();
    for (const b of plainAll(db.prepare('SELECT * FROM budget_month').all())) {
      this.bMonth.set(`${b.company_id}|${b.month_key}|${b.item}`, b.value);
      const k = `${b.company_id}|${fyOf(b.month_key, this.fyStartMonth)}|${b.item}`;
      this.bSpecificSum.set(k, (this.bSpecificSum.get(k) || 0) + b.value);
    }
    this.drafts = new Map();
    this._fx = new Map();
    this.fxMissing = new Set();
    this._chains = new Map();
  }

  // ---- items
  items(cid) {
    const out = [...this.inputCodes];
    for (const s of this.skus.get(cid) || []) out.push(`SKU:${s.id}:PQ`, `SKU:${s.id}:SQ`, `SKU:${s.id}:SV`);
    return out;
  }
  budgetItems(cid) {
    return [...this.lines.filter((l) => l.budget).map((l) => l.code), ...(this.skus.get(cid) || []).flatMap((s) => [`SKU:${s.id}:PQ`, `SKU:${s.id}:SQ`, `SKU:${s.id}:SV`])];
  }
  itemLabel(item) {
    const sk = /^SKU:(\d+):(PQ|SQ|SV)$/.exec(item);
    if (sk) {
      for (const list of this.skus.values()) {
        const s = list.find((x) => x.id === Number(sk[1]));
        if (s) return `${s.name} – ${SKU_PART[sk[2]].toLowerCase()}${sk[2] !== 'SV' ? ` (${s.unit})` : ''}`;
      }
      return item;
    }
    return this.m.byCode.get(item)?.name || item;
  }

  // ---- data
  data(cid, week) {
    const k = `${cid}|${week}`;
    return this.drafts.has(k) ? this.drafts.get(k) : this.filings.get(k) || null;
  }
  setDraft(cid, week, d) { this.drafts.set(`${cid}|${week}`, d); this._chains.delete(cid); }

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

  // Base values for one portion (local currency): inputs, plus adjustments if booked in that month
  portionBase(cid, d, week, month, withAdj) {
    const base = {};
    if (!d) return base;
    for (const [item, byM] of Object.entries(d.values || {})) if (byM[month] != null) base[item] = byM[month];
    if (withAdj && P.segments(week)[0].month === month) {
      for (const [item, a] of Object.entries(d.adj || {})) base[item] = addv(base[item] ?? null, a.value);
    }
    return base;
  }

  // Cash roll-forward: opening/closing for every portion from the company's start week
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
            const base = this.portionBase(cid, d, w, s.month, true);
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

  // Month-to-date actual for item in month mo, weeks up to W (incl. adjustments booked in mo)
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

  // All vectors for one company, week W, MTD month M. translate → group currency.
  companyVectors(c, W, M, translate) {
    const setup = this.setup.get(c.id);
    if (!setup || W < setup.start_week) return null;
    const segs = P.segments(W);
    const mseg = segs.find((s) => s.month === M) || segs[segs.length - 1];
    M = mseg.month;
    const rate = (mo) => (translate ? this.fx(c.currency, mo) : 1);
    const rr = (item, mo) => (isQty(item) ? 1 : rate(mo));
    const d = this.data(c.id, W);
    const start = setup.start_week;
    const mweeks = P.monthWeeks(M).filter((w) => w >= start && w <= W);
    const fyMonths = P.fyMonths(M, this.fyStartMonth);
    const prevW = [...mweeks].reverse().find((w) => w < W && this.data(c.id, w));
    const prevD = prevW ? this.data(c.id, prevW) : null;
    const adjMonth = segs[0].month;

    const V = { wkA: {}, wkT: {}, adjW: {}, mtdA: {}, mtdT: {}, ytdA: {}, ytdT: {}, prev: {}, thisWk: {} };
    for (const item of this.items(c.id)) {
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
      // YTD = full earlier months of the fiscal year + MTD
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
    // SKU sales value total feeds revenue
    const skuTotal = this.lines.find((l) => l.kind === 'sku_total')?.code;
    if (skuTotal) {
      for (const vec of Object.values(V)) {
        let t = null;
        for (const [k, v] of Object.entries(vec)) if (k.endsWith(':SV')) t = addv(t, v);
        if (t != null) vec[skuTotal] = t;
      }
    }
    // Cash opening / closing from the roll-forward
    const ch = this.chain(c.id);
    const firstIn = (mo) => {
      const w = P.monthWeeks(mo).find((x) => x >= start);
      return w && w <= W ? ch.get(`${w}|${mo}`) : null;
    };
    const oc = this.m.openingCode;
    const wkOpen = ch.get(`${W}|${segs[0].month}`)?.open;
    const mOpen = firstIn(M)?.open;
    const fyOpen = fyMonths.map(firstIn).find(Boolean)?.open;
    if (wkOpen != null) V.wkA[oc] = V.wkT[oc] = wkOpen * rate(segs[0].month);
    if (mOpen != null) V.mtdA[oc] = V.mtdT[oc] = V.prev[oc] = mOpen * rate(M);
    if (fyOpen != null) V.ytdA[oc] = V.ytdT[oc] = fyOpen * rate(fyMonths[0]);
    const lastSeg = segs[segs.length - 1];
    const cl = (e, mo) => (e?.close != null ? e.close * rate(mo) : null);
    const closing = { wk: cl(ch.get(`${W}|${lastSeg.month}`), lastSeg.month), mtd: cl(ch.get(`${W}|${M}`), M) };
    closing.ytd = closing.mtd;

    return {
      V, closing, filed: !!d, segs, M,
      adjList: Object.entries(d?.adj || {}).map(([item, a]) => ({ item, label: this.itemLabel(item), value: a.value, reason: a.reason, currency: c.currency })),
    };
  }

  // Sum company vectors; collapse SKU items to unit totals when looking above company level
  aggregate(list, collapse) {
    const out = { V: {}, closing: { wk: null, mtd: null, ytd: null } };
    for (const cv of list) {
      for (const [vn, vec] of Object.entries(cv.V)) {
        out.V[vn] ||= {};
        for (const [item, v] of Object.entries(vec)) {
          let key = item;
          if (collapse && item.startsWith('SKU:')) {
            const [, id, part] = item.split(':');
            if (part === 'SV') continue;
            const sku = [...this.skus.values()].flat().find((s) => s.id === Number(id));
            key = `UNIT:${part}:${sku?.unit || 'units'}`;
          }
          out.V[vn][key] = addv(out.V[vn][key] ?? null, v);
        }
      }
      for (const k of ['wk', 'mtd', 'ytd']) out.closing[k] = addv(out.closing[k], cv.closing[k]);
    }
    return out;
  }

  // Turn summed vectors into display rows
  rows(agg, companyId) {
    const D = {};
    for (const vn of ['wkA', 'wkT', 'adjW', 'mtdA', 'mtdT', 'ytdA', 'ytdT', 'prev', 'thisWk']) {
      const vec = agg.V[vn] || {};
      if (vn === 'adjW') { const b = { ...vec }; delete b[this.m.openingCode]; D[vn] = { ...vec, ...derive(this.m, b) }; continue; }
      D[vn] = { ...vec, ...derive(this.m, vec) };
    }
    const cc = this.m.closingCode;
    if (agg.closing.wk != null) D.wkA[cc] = agg.closing.wk;
    if (agg.closing.mtd != null) D.mtdA[cc] = agg.closing.mtd;
    if (agg.closing.ytd != null) D.ytdA[cc] = agg.closing.ytd;

    const mk = (code, name, extra = {}) => {
      const pct = extra.fmt === 'percent';
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

    const sections = this.sections.map((s) => ({ code: s.code, name: s.name, rows: [] }));
    const sec = (code) => sections.find((s) => s.code === code);
    for (const l of this.m.list) {
      const depth = (() => { let n = 0; for (let p = this.m.byCode.get(l.parent_code); p; p = this.m.byCode.get(p.parent_code)) n++; return n; })();
      sec(l.section)?.rows.push(mk(l.code, l.name, { fmt: l.fmt, hib: l.hib, depth, kind: l.kind, nature: l.nature, strong: l.kind === 'sum' || l.kind === 'formula', kpi: l.is_kpi }));
    }
    const ps = sections.find((s) => s.code === 'PRODSALES');
    if (ps) {
      if (companyId) {
        for (const s of this.skus.get(companyId) || []) {
          ps.rows.push({ group: true, name: `${s.name}`, unit: s.unit });
          ps.rows.push(mk(`SKU:${s.id}:PQ`, `Production (${s.unit})`, { fmt: 'qty', depth: 1 }));
          ps.rows.push(mk(`SKU:${s.id}:SQ`, `Sales (${s.unit})`, { fmt: 'qty', depth: 1 }));
          ps.rows.push(mk(`SKU:${s.id}:SV`, 'Sales value', { depth: 1 }));
        }
      } else {
        const units = new Set(Object.keys({ ...D.wkA, ...D.mtdA, ...D.ytdA }).filter((k) => k.startsWith('UNIT:')).map((k) => k.split(':')[2]));
        for (const u of [...units].sort()) {
          ps.rows.push(mk(`UNIT:PQ:${u}`, `Production (${u})`, { fmt: 'qty' }));
          ps.rows.push(mk(`UNIT:SQ:${u}`, `Sales (${u})`, { fmt: 'qty' }));
        }
      }
      const st = this.lines.find((l) => l.kind === 'sku_total');
      if (st) ps.rows.push({ ...mk(st.code, 'Total sales value'), strong: true });
    }
    return sections;
  }

  // Full weekly view for a node
  weekView(nodeId, W, M, { children = true } = {}) {
    const node = this.tree.byId.get(nodeId);
    const isCo = node.type === 'company';
    const companies = companiesUnder(this.tree, nodeId);
    const segs = P.segments(W);
    if (!M || !segs.some((s) => s.month === M)) M = segs[segs.length - 1].month;
    const cvs = [];
    const status = [];
    const adjustments = [];
    for (const c of companies) {
      const cv = this.companyVectors(c, W, M, !isCo);
      status.push({ id: c.id, name: c.name, started: !!cv, filed: !!cv?.filed });
      if (!cv) continue;
      cvs.push(cv);
      cv.adjList.forEach((a) => adjustments.push({ ...a, company: c.name }));
    }
    const agg = this.aggregate(cvs, !isCo);
    const out = {
      node: { id: node.id, name: node.name, type: node.type, currency: isCo ? node.currency : this.groupCcy },
      week: P.describeWeek(W), month: M, month_label: P.monthLabel(M), fy_label: P.fyLabel(M, this.fyStartMonth),
      sections: this.rows(agg, isCo ? node.id : null),
      coverage: { companies: status.length, started: status.filter((s) => s.started).length, filed: status.filter((s) => s.filed).length, status },
      adjustments,
    };
    if (children && !isCo) {
      out.children = node.children.filter((c) => c.active && companiesUnder(this.tree, c.id).length).map((c) => {
        const v = this.weekView(c.id, W, M, { children: false });
        const flat = {};
        for (const s of v.sections) for (const r of s.rows) if (r.code && !r.code.startsWith('UNIT:')) flat[r.code] = { wk: r.wk, mtd: r.mtd, ytd: r.ytd, adj: r.adj };
        return { id: c.id, name: c.name, type: c.type, rows: flat, coverage: v.coverage };
      });
    }
    return out;
  }

  // Month view: one column per week portion, plus adjustments, total, budget and YTD
  monthView(nodeId, M, uptoWeek) {
    const node = this.tree.byId.get(nodeId);
    const isCo = node.type === 'company';
    const companies = companiesUnder(this.tree, nodeId);
    const weeks = P.monthWeeks(M).filter((w) => w <= uptoWeek);
    const fyMonths = P.fyMonths(M, this.fyStartMonth);
    const cols = weeks.map((w) => ({ week: w, seg: P.segments(w).find((s) => s.month === M) }));
    const withData = cols.filter(({ week }) => companies.some((c) => this.data(c.id, week)));
    const lastEnd = withData.length ? withData[withData.length - 1].seg.end : null;
    const acc = { cols: cols.map(() => ({ V: {}, open: null, close: null })), adj: {}, total: {}, budget: {}, btd: {}, ytd: {}, ytdB: {} };
    const opens = { total: null, budget: null, ytd: null };
    const closes = { total: null, ytd: null };
    const add = (o, k, v) => { if (v != null) o[k] = addv(o[k] ?? null, v); };
    const oc = this.m.openingCode;

    for (const c of companies) {
      const setup = this.setup.get(c.id);
      if (!setup) continue;
      const rate = (mo) => (!isCo ? this.fx(c.currency, mo) : 1);
      const rr = (item, mo) => (isQty(item) ? 1 : rate(mo));
      const ch = this.chain(c.id);
      const collapse = (item) => {
        if (isCo || !item.startsWith('SKU:')) return item;
        const [, id, part] = item.split(':');
        if (part === 'SV') return `SKUSV:${id}`;
        const sku = (this.skus.get(c.id) || []).find((s) => s.id === Number(id));
        return `UNIT:${part}:${sku?.unit || 'units'}`;
      };
      cols.forEach(({ week, seg }, i) => {
        if (week < setup.start_week) return;
        const d = this.data(c.id, week);
        const e = ch.get(`${week}|${M}`);
        if (e) { acc.cols[i].open = addv(acc.cols[i].open, e.open * rate(M)); acc.cols[i].close = addv(acc.cols[i].close, e.close * rate(M)); }
        if (!d) return;
        for (const [item, byM] of Object.entries(d.values || {})) add(acc.cols[i].V, collapse(item), byM[M] != null ? byM[M] * rr(item, M) : null);
        if (P.segments(week)[0].month === M) for (const [item, a] of Object.entries(d.adj || {})) add(acc.adj, collapse(item), a.value * rr(item, M));
      });
      for (const item of this.items(c.id)) {
        const ma = this.monthActual(c.id, M, uptoWeek, item, setup.start_week);
        add(acc.total, collapse(item), ma != null ? ma * rr(item, M) : null);
        const b = this.budget(c.id, M, item);
        if (b != null) {
          add(acc.budget, collapse(item), b * rr(item, M));
          if (lastEnd) add(acc.btd, collapse(item), (b * P.elapsed(M, lastEnd) / P.daysInMonth(M)) * rr(item, M));
        }
        for (const mo of fyMonths) {
          const a = this.monthActual(c.id, mo, uptoWeek, item, setup.start_week);
          if (a != null) add(acc.ytd, collapse(item), a * rr(item, mo));
          const bb = this.budget(c.id, mo, item);
          if (bb != null) add(acc.ytdB, collapse(item), (mo === M && lastEnd ? bb * P.elapsed(M, lastEnd) / P.daysInMonth(M) : bb) * rr(item, mo));
        }
      }
      const first = (mo) => { const w = P.monthWeeks(mo).find((x) => x >= setup.start_week); return w ? ch.get(`${w}|${mo}`) : null; };
      const mo0 = first(M);
      if (mo0) { opens.total = addv(opens.total, mo0.open * rate(M)); opens.budget = addv(opens.budget, mo0.open * rate(M)); }
      const fy0 = fyMonths.map(first).find(Boolean);
      if (fy0) opens.ytd = addv(opens.ytd, fy0.open * rate(fyMonths[0]));
      const lastCol = [...cols].reverse().find((x) => x.week >= setup.start_week);
      const le = lastCol ? ch.get(`${lastCol.week}|${M}`) : null;
      if (le) { closes.total = addv(closes.total, le.close * rate(M)); closes.ytd = addv(closes.ytd, le.close * rate(M)); }
    }

    const skuTotal = this.lines.find((l) => l.kind === 'sku_total')?.code;
    const finish = (vec, open, close) => {
      const v = { ...vec };
      let t = null;
      for (const [k, x] of Object.entries(v)) if (k.endsWith(':SV') || k.startsWith('SKUSV:')) t = addv(t, x);
      if (t != null && skuTotal) v[skuTotal] = t;
      if (open != null) v[oc] = open;
      const dv = { ...v, ...derive(this.m, v) };
      if (close != null) dv[this.m.closingCode] = close;
      return dv;
    };
    const C = acc.cols.map((x) => finish(x.V, x.open, x.close));
    const A = finish(acc.adj, null, null);
    delete A[oc];
    const T = finish(acc.total, opens.total, closes.total);
    const B = finish(acc.budget, opens.budget, null);
    const BT = finish(acc.btd, opens.budget, null);
    const Y = finish(acc.ytd, opens.ytd, closes.ytd);
    const YB = finish(acc.ytdB, opens.ytd, null);

    const mk = (code, name, extra = {}) => ({
      code, name, fmt: 'amount', hib: 1, depth: 0, ...extra,
      cols: C.map((x) => x[code] ?? null), adj: extra.nature === 'opening' ? null : A[code] ?? null,
      total: T[code] ?? null, budget: B[code] ?? null, btd: BT[code] ?? null, ytd: Y[code] ?? null, ytdB: YB[code] ?? null,
    });
    const sections = this.sections.map((s) => ({ code: s.code, name: s.name, rows: [] }));
    for (const l of this.m.list) {
      let depth = 0;
      for (let p = this.m.byCode.get(l.parent_code); p; p = this.m.byCode.get(p.parent_code)) depth++;
      sections.find((s) => s.code === l.section)?.rows.push(mk(l.code, l.name, { fmt: l.fmt, hib: l.hib, depth, nature: l.nature, strong: l.kind === 'sum' || l.kind === 'formula' }));
    }
    const ps = sections.find((s) => s.code === 'PRODSALES');
    if (ps) {
      if (isCo) {
        for (const s of this.skus.get(node.id) || []) {
          ps.rows.push({ group: true, name: s.name });
          ps.rows.push(mk(`SKU:${s.id}:PQ`, `Production (${s.unit})`, { fmt: 'qty', depth: 1 }));
          ps.rows.push(mk(`SKU:${s.id}:SQ`, `Sales (${s.unit})`, { fmt: 'qty', depth: 1 }));
          ps.rows.push(mk(`SKU:${s.id}:SV`, 'Sales value', { depth: 1 }));
        }
      } else {
        const units = new Set([...Object.keys(T), ...Object.keys(B)].filter((k) => k.startsWith('UNIT:')).map((k) => k.split(':')[2]));
        for (const u of [...units].sort()) {
          ps.rows.push(mk(`UNIT:PQ:${u}`, `Production (${u})`, { fmt: 'qty' }));
          ps.rows.push(mk(`UNIT:SQ:${u}`, `Sales (${u})`, { fmt: 'qty' }));
        }
      }
      if (skuTotal) ps.rows.push({ ...mk(skuTotal, 'Total sales value'), strong: true });
    }
    return {
      node: { id: node.id, name: node.name, type: node.type, currency: isCo ? node.currency : this.groupCcy },
      month: M, month_label: P.monthLabel(M), fy_label: P.fyLabel(M, this.fyStartMonth),
      columns: cols.map(({ week, seg }) => ({ week, label: seg.label, days: seg.days, partial: seg.days < 7 })),
      sections,
    };
  }
}
