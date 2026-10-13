// Shared with the client (client/src/lib/calc.js is a copy). Pure functions only.
import { parse, evaluate } from './formula.js';

export const addv = (a, b) => (a == null ? b : b == null ? a : a + b);

// lines: [{ code, kind, formula, parent_code, fmt }] in display order
export function buildModel(lines) {
  const byCode = new Map(lines.map((l) => [l.code, { ...l, children: [] }]));
  for (const l of byCode.values()) {
    if (l.parent_code && byCode.has(l.parent_code)) byCode.get(l.parent_code).children.push(l);
    if (l.kind === 'formula') { try { l.ast = parse(l.formula); } catch { l.ast = null; } }
  }
  return {
    list: lines.map((l) => byCode.get(l.code)),
    byCode,
    openingCode: lines.find((l) => l.kind === 'opening')?.code,
    closingCode: lines.find((l) => l.nature === 'closing')?.code,
  };
}

// base: { code: value } for input / sku_total / opening lines. Returns values for every line.
export function derive(m, base) {
  const out = {};
  const busy = new Set();
  const calc = (l) => {
    if (l.code in out) return out[l.code];
    if (busy.has(l.code)) return null;
    busy.add(l.code);
    let v = null;
    if (l.kind === 'sum') {
      for (const c of l.children) v = addv(v, calc(c));
    } else if (l.kind === 'cfnet') {
      // net of lines tagged '+CLASS' (inflows) and '-CLASS' (outflows)
      for (const x of m.list) {
        if (!x.cf || x.cf.slice(1) !== l.formula) continue;
        const xv = calc(x);
        if (xv != null) v = addv(v, x.cf[0] === '-' ? -xv : xv);
      }
    } else if (l.kind === 'formula') {
      if (l.ast) {
        let any = false;
        let missing = false;
        v = evaluate(l.ast, (code) => {
          const r = m.byCode.get(code);
          const x = r ? calc(r) : null;
          if (x == null) missing = true; else any = true;
          return x;
        });
        // ratios need every part; amounts treat blanks as zero
        if (!any || (l.fmt === 'percent' && missing)) v = null;
      }
    } else {
      v = base[l.code] ?? null;
    }
    busy.delete(l.code);
    out[l.code] = v;
    return v;
  };
  m.list.forEach(calc);
  return out;
}
