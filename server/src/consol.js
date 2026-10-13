import { db, getSettings, plainAll } from './db.js';
import { parse, evaluate } from './formula.js';
import * as P from './periods.js';

// ---------------------------------------------------------------- tree

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

export function descendantIds(tree, id) {
  const out = [];
  const walk = (n) => { out.push(n.id); n.children.forEach(walk); };
  const start = tree.byId.get(id);
  if (start) walk(start);
  return out;
}

export function companiesUnder(tree, id, { includeInactive = false } = {}) {
  return descendantIds(tree, id)
    .map((i) => tree.byId.get(i))
    .filter((n) => n.type === 'company' && (includeInactive || n.active));
}

export function isWithin(tree, ancestorId, nodeId) {
  for (let n = tree.byId.get(nodeId); n; n = tree.byId.get(n.parent_id)) if (n.id === ancestorId) return true;
  return false;
}

export function pathOf(tree, nodeId) {
  const out = [];
  for (let n = tree.byId.get(nodeId); n; n = tree.byId.get(n.parent_id)) out.unshift({ id: n.id, name: n.name, type: n.type, code: n.code });
  return out;
}

// ---------------------------------------------------------------- heads

export function loadHeads() {
  const heads = plainAll(db.prepare('SELECT * FROM heads WHERE active = 1 ORDER BY sort, id').all());
  const byId = new Map(heads.map((h) => [h.id, { ...h, children: [] }]));
  const byCode = new Map();
  const roots = [];
  for (const h of byId.values()) {
    byCode.set(h.code, h);
    if (h.parent_id && byId.has(h.parent_id)) byId.get(h.parent_id).children.push(h);
    else roots.push(h);
    if (h.head_type === 'formula' && h.formula) {
      try { h.ast = parse(h.formula); } catch { h.ast = null; }
    }
  }
  // depth-first ordered list for display
  const ordered = [];
  const walk = (h, depth) => { h.depth = depth; ordered.push(h); h.children.forEach((c) => walk(c, depth + 1)); };
  roots.forEach((r) => walk(r, 0));
  return { byId, byCode, roots, ordered };
}

// inputs: Map(headId -> number). Returns Map(headId -> number|null) for every head.
export function computeHeads(model, inputs) {
  const out = new Map();
  const visiting = new Set();
  const calc = (h) => {
    if (out.has(h.id)) return out.get(h.id);
    if (visiting.has(h.id)) return null; // cycle guard
    visiting.add(h.id);
    let v = null;
    if (h.head_type === 'input') {
      v = inputs.has(h.id) ? inputs.get(h.id) : null;
      // An input head may also have children (sub-analysis); add them if present
      if (h.children.length) {
        const kids = h.children.map(calc).filter((x) => x != null);
        if (kids.length) v = (v ?? 0) + kids.reduce((a, b) => a + b, 0);
      }
    } else if (h.head_type === 'group') {
      const kids = h.children.map(calc).filter((x) => x != null);
      v = kids.length ? kids.reduce((a, b) => a + b, 0) : null;
    } else if (h.head_type === 'formula' && h.ast) {
      let any = false;
      v = evaluate(h.ast, (code) => {
        const ref = model.byCode.get(code);
        if (!ref) return 0;
        const r = calc(ref);
        if (r != null) any = true;
        return r;
      });
      if (!any) v = null;
    }
    visiting.delete(h.id);
    out.set(h.id, v);
    return v;
  };
  model.ordered.forEach(calc);
  return out;
}

// Input-type heads that roll into a head (itself, its descendants, and formula references).
export function feedingInputHeads(model, headId) {
  const set = new Set();
  const seen = new Set();
  const walk = (h) => {
    if (!h || seen.has(h.id)) return;
    seen.add(h.id);
    if (h.head_type === 'input') set.add(h.id);
    h.children.forEach(walk);
    if (h.head_type === 'formula' && h.formula) {
      for (const m of h.formula.matchAll(/[A-Za-z_][A-Za-z0-9_.]*/g)) walk(model.byCode.get(m[0]));
    }
  };
  walk(model.byId.get(headId));
  return set;
}

// ---------------------------------------------------------------- company lines

// lines: company_lines rows (active, sorted). values: Map(lineId -> number|null)
export function computeLines(lines, values) {
  const byCode = new Map(lines.map((l) => [l.code, l]));
  const out = new Map();
  const visiting = new Set();
  const calc = (l) => {
    if (out.has(l.id)) return out.get(l.id);
    if (visiting.has(l.id)) return null;
    visiting.add(l.id);
    let v = null;
    if (l.line_type === 'input') v = values.has(l.id) ? values.get(l.id) : null;
    else if (l.line_type === 'formula' && l.formula) {
      try {
        let any = false;
        v = evaluate(parse(l.formula), (code) => {
          const ref = byCode.get(code);
          if (!ref) return 0;
          const r = calc(ref);
          if (r != null) any = true;
          return r;
        });
        if (!any) v = null;
      } catch { v = null; }
    }
    visiting.delete(l.id);
    out.set(l.id, v);
    return v;
  };
  lines.forEach(calc);
  return out;
}

export function headTotalsFromLines(lines, computed) {
  const totals = {};
  for (const l of lines) {
    if (!l.head_id || l.line_type === 'header') continue;
    const v = computed.get(l.id);
    if (v == null) continue;
    totals[l.head_id] = (totals[l.head_id] || 0) + v * (l.sign || 1);
  }
  return totals;
}

// ---------------------------------------------------------------- filings & fx

export class Ctx {
  constructor() {
    this.settings = getSettings();
    this.fyStart = Number(this.settings.fiscal_year_start_month || 1);
    this.groupCcy = this.settings.group_currency || 'PKR';
    this.tree = loadTree();
    this.heads = loadHeads();
    this._filings = new Map();
    this._fx = new Map();
    this.fxMissing = new Set();
    this._stmtFiling = db.prepare(
      'SELECT * FROM filings WHERE company_id = ? AND frequency = ? AND period_key = ? ORDER BY revision DESC LIMIT 1');
    this._stmtFx = db.prepare('SELECT rate FROM fx_rates WHERE currency = ? AND month_key <= ? ORDER BY month_key DESC LIMIT 1');
  }

  filing(companyId, freq, key) {
    const k = `${companyId}|${freq}|${key}`;
    if (!this._filings.has(k)) {
      const r = this._stmtFiling.get(companyId, freq, key);
      this._filings.set(k, r ? { ...r, lines: JSON.parse(r.lines_json), heads: JSON.parse(r.heads_json) } : null);
    }
    return this._filings.get(k);
  }

  fx(currency, freq, key) {
    if (!currency || currency === this.groupCcy) return 1;
    const month = P.monthOf(freq, key);
    const k = `${currency}|${month}`;
    if (!this._fx.has(k)) {
      const r = this._stmtFx.get(currency, month);
      if (!r) this.fxMissing.add(`${currency} ${month}`);
      this._fx.set(k, r ? r.rate : 1);
    }
    return this._fx.get(k);
  }

  // Aggregate one company's filed inputs across keys, in group currency.
  companyInputs(company, freq, keys) {
    const inputs = new Map();
    const filed = [];
    const perKey = [];
    for (const key of keys) {
      const f = this.filing(company.id, freq, key);
      if (!f) continue;
      filed.push(key);
      perKey.push({ key, heads: f.heads, rate: this.fx(f.currency, freq, key) });
    }
    for (const h of this.heads.byId.values()) {
      if (h.head_type !== 'input') continue;
      const vals = perKey.filter((p) => p.heads[h.id] != null)
        .map((p) => p.heads[h.id] * (h.fmt === 'amount' ? p.rate : 1)); // counts/ratios are not translated
      if (!vals.length) continue;
      let v;
      if (h.nature === 'balance') v = vals[vals.length - 1];
      else if (h.nature === 'average') v = vals.reduce((a, b) => a + b, 0) / vals.length;
      else v = vals.reduce((a, b) => a + b, 0);
      inputs.set(h.id, v);
    }
    return { inputs, filed };
  }

  // Consolidated values for a node across keys. Returns { values: Map(headId->v), coverage }
  // only: optional Set of company ids (like-for-like comparatives)
  consolidate(nodeId, freq, keys, only = null) {
    const companies = companiesUnder(this.tree, nodeId).filter((c) => !only || only.has(c.id));
    const total = new Map();
    const cov = { expected: companies.length * keys.length, filed: 0, companies: companies.length };
    for (const c of companies) {
      const { inputs, filed } = this.companyInputs(c, freq, keys);
      cov.filed += filed.length;
      for (const [hid, v] of inputs) total.set(hid, (total.get(hid) || 0) + v);
    }
    return { values: computeHeads(this.heads, total), coverage: cov };
  }

  // Companies under a node with at least one filing in keys
  filers(nodeId, freq, keys) {
    return new Set(companiesUnder(this.tree, nodeId).filter((c) => keys.some((k) => this.filing(c.id, freq, k))).map((c) => c.id));
  }
}

export function headOut(h) {
  return {
    id: h.id, code: h.code, name: h.name, parent_id: h.parent_id, depth: h.depth, statement: h.statement,
    head_type: h.head_type, nature: h.nature, fmt: h.fmt, higher_is_better: h.higher_is_better,
    frequency: h.frequency, is_kpi: h.is_kpi, formula: h.formula,
  };
}

export function comparativeKeys(freq, key, mode, fyStart) {
  const cur = P.rangeKeys(freq, key, mode, fyStart);
  const ly = cur.map((k) => P.lastYear(freq, k));
  let prev = null;
  if (mode === 'period' || !mode) prev = [P.prev(freq, key)];
  else if (mode === 'qtd') prev = P.rangeKeys(freq, P.shift(freq, cur[0], -1), 'qtd', fyStart);
  else if (mode === 'mtd') prev = P.rangeKeys(freq, P.prev(freq, cur[0]), 'mtd', fyStart);
  return { cur, prev, ly };
}

// ---------------------------------------------------------------- filing status

export function filingStatus(ctx, nodeId, freq, key) {
  const companies = companiesUnder(ctx.tree, nodeId);
  const due = P.dueDate(freq, key, ctx.settings[`${freq}_due_days`]);
  const now = new Date();
  const sub = db.prepare('SELECT * FROM submissions WHERE company_id = ? AND frequency = ? AND period_key = ?');
  return companies.map((c) => {
    const f = ctx.filing(c.id, freq, key);
    const s = sub.get(c.id, freq, key);
    let status = 'missing';
    if (s && s.status === 'reopened') status = 'reopened';
    else if (f) status = 'filed';
    else if (s) status = 'draft';
    const overdue = !f && now > due;
    return {
      company_id: c.id, code: c.code, name: c.name, parent_id: c.parent_id,
      status, overdue, revision: f ? f.revision : null, filed_at: f ? f.filed_at : null,
    };
  });
}
