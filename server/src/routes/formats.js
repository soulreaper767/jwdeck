import { Router } from 'express';
import { db, tx, audit, plainAll } from '../db.js';
import { requireRole, canView } from '../auth.js';
import { loadHeads, loadTree } from '../consol.js';
import { parse, refs } from '../formula.js';
import { h, bad, forbidden, notFound, bool } from './util.js';

const r = Router();
const FREQS = ['weekly', 'monthly'];

function company(id) {
  const c = db.prepare("SELECT * FROM nodes WHERE id = ? AND type = 'company'").get(Number(id));
  if (!c) throw notFound('Company not found');
  return { ...c };
}

export function activeLines(companyId, freq) {
  return plainAll(db.prepare(
    'SELECT * FROM company_lines WHERE company_id = ? AND frequency = ? AND active = 1 ORDER BY sort, id').all(companyId, freq));
}

function warnings(lines, heads, freq) {
  const out = [];
  const byCode = new Map(lines.map((l) => [l.code, l]));
  for (const l of lines) {
    if (l.line_type === 'input' && !l.head_id) out.push({ line: l.code, msg: `"${l.label}" is not mapped to a group head, so it will not be consolidated.` });
    if (l.head_id) {
      const hd = heads.byId.get(l.head_id);
      if (!hd) out.push({ line: l.code, msg: `"${l.label}" is mapped to an inactive or deleted head.` });
      else if (hd.frequency !== 'both' && hd.frequency !== freq) out.push({ line: l.code, msg: `"${l.label}" maps to ${hd.code}, which is a ${hd.frequency}-only head.` });
    }
    if (l.line_type === 'formula' && l.head_id && l.formula) {
      const overlap = refs(l.formula).map((c) => byCode.get(c)).filter((x) => x && x.head_id);
      if (overlap.length) out.push({ line: l.code, msg: `"${l.label}" is mapped and so are its parts (${overlap.map((x) => x.code).join(', ')}). Those figures will be counted twice.` });
    }
  }
  return out;
}

r.get('/formats/:companyId/:freq', h((req) => {
  const c = company(req.params.companyId);
  const { freq } = req.params;
  if (!FREQS.includes(freq)) throw bad('Invalid frequency');
  if (!canView(req.user, c.id)) throw forbidden();
  const lines = activeLines(c.id, freq);
  const used = new Set(plainAll(db.prepare(
    'SELECT DISTINCT line_id FROM submission_values v JOIN submissions s ON s.id = v.submission_id WHERE s.company_id = ?').all(c.id))
    .map((x) => x.line_id));
  const heads = loadHeads();
  return {
    company: c,
    frequency: freq,
    lines: lines.map((l) => ({ ...l, has_values: used.has(l.id) })),
    warnings: warnings(lines, heads, freq),
  };
}));

// Proposed lines (unsaved) from the standard heads or another company's format.
r.get('/formats/template', requireRole('admin'), h((req) => {
  const { source, frequency, company_id, from_frequency } = req.query;
  if (!FREQS.includes(frequency)) throw bad('Invalid frequency');
  if (source === 'company') {
    const src = activeLines(company(company_id).id, from_frequency || frequency);
    return src.map(({ id, company_id: _c, frequency: _f, ...rest }) => rest);
  }
  const heads = loadHeads();
  const out = [];
  let sort = 0;
  const fits = (hd) => hd.frequency === 'both' || hd.frequency === frequency;
  const walk = (hd) => {
    if (!fits(hd)) return;
    const kids = hd.children.filter(fits);
    if (hd.head_type === 'section') {
      out.push({ code: `H_${hd.code}`, label: hd.name.toUpperCase(), line_type: 'header', bold: 1, indent: 0, sign: 1, sort: sort += 10 });
      kids.forEach(walk);
    } else if (hd.head_type === 'group') {
      out.push({ code: `H_${hd.code}`, label: hd.name, line_type: 'header', bold: 1, indent: hd.depth, sign: 1, sort: sort += 10 });
      kids.forEach(walk);
      if (kids.length) {
        out.push({ code: hd.code, label: `Total ${hd.name}`, line_type: 'formula', formula: kids.map((k) => k.code).join(' + '),
          bold: 1, indent: hd.depth, sign: 1, sort: sort += 10 });
      }
    } else if (hd.head_type === 'formula') {
      out.push({ code: hd.code, label: hd.name, line_type: 'formula', formula: hd.formula, bold: 1, indent: hd.depth, sign: 1, sort: sort += 10 });
    } else {
      out.push({ code: hd.code, label: hd.name, line_type: 'input', head_id: hd.id, indent: hd.depth, sign: 1, sort: sort += 10, required: 0 });
      kids.forEach(walk);
    }
  };
  heads.roots.forEach(walk);
  return out;
}));

r.put('/formats/:companyId/:freq', requireRole('admin'), h((req) => {
  const c = company(req.params.companyId);
  const { freq } = req.params;
  if (!FREQS.includes(freq)) throw bad('Invalid frequency');
  const incoming = Array.isArray(req.body?.lines) ? req.body.lines : null;
  if (!incoming) throw bad('lines[] required');

  const heads = loadHeads();
  const seen = new Set();
  const lines = incoming.map((l, i) => {
    const code = String(l.code || '').trim().toUpperCase();
    if (!/^[A-Z_][A-Z0-9_.]*$/.test(code)) throw bad(`Line ${i + 1}: code must start with a letter and use only A-Z, 0-9, _ or .`);
    if (seen.has(code)) throw bad(`Duplicate line code ${code}`);
    seen.add(code);
    const label = String(l.label || '').trim();
    if (!label) throw bad(`Line ${code}: label is required`);
    const line_type = ['header', 'input', 'formula'].includes(l.line_type) ? l.line_type : 'input';
    const formula = line_type === 'formula' ? String(l.formula || '').trim().toUpperCase() : null;
    if (line_type === 'formula') {
      if (!formula) throw bad(`Line ${code}: formula is required`);
      try { parse(formula); } catch (e) { throw bad(`Line ${code}: ${e.message}`); }
    }
    const head_id = line_type === 'header' ? null : (l.head_id ? Number(l.head_id) : null);
    if (head_id) {
      const hd = heads.byId.get(head_id);
      if (!hd) throw bad(`Line ${code}: mapped head not found`);
      if (hd.head_type !== 'input') throw bad(`Line ${code}: can only map to an input head (${hd.code} is ${hd.head_type})`);
    }
    return {
      id: l.id ? Number(l.id) : null, code, label, line_type, formula, head_id,
      sign: Number(l.sign) === -1 ? -1 : 1, indent: Math.max(0, Math.min(4, Number(l.indent) || 0)),
      bold: bool(l.bold), required: line_type === 'input' ? bool(l.required) : 0, sort: (i + 1) * 10,
    };
  });
  for (const l of lines) {
    if (l.line_type !== 'formula') continue;
    const missing = refs(l.formula).filter((x) => !seen.has(x));
    if (missing.length) throw bad(`Line ${l.code}: unknown code(s) ${missing.join(', ')}`);
    if (refs(l.formula).includes(l.code)) throw bad(`Line ${l.code}: formula cannot reference itself`);
  }

  tx(() => {
    const existing = plainAll(db.prepare('SELECT * FROM company_lines WHERE company_id = ? AND frequency = ?').all(c.id, freq));
    const byId = new Map(existing.map((x) => [x.id, x]));
    // A new row reusing an existing code is treated as that same line (keeps its history).
    const byCode = new Map(existing.map((x) => [x.code, x]));
    for (const l of lines) if (l.id && !byId.has(l.id)) l.id = null;
    const claimed = new Set(lines.filter((l) => l.id).map((l) => l.id));
    for (const l of lines) {
      const match = byCode.get(l.code);
      if (!l.id && match && !claimed.has(match.id)) { l.id = match.id; claimed.add(match.id); }
    }
    // free up codes before re-assigning, to allow swaps
    db.prepare("UPDATE company_lines SET code = '__tmp_' || id WHERE company_id = ? AND frequency = ?").run(c.id, freq);
    const keep = new Set(lines.filter((l) => l.id).map((l) => l.id));
    const usedStmt = db.prepare('SELECT COUNT(*) c FROM submission_values WHERE line_id = ?');
    for (const x of existing) {
      if (keep.has(x.id)) continue;
      if (usedStmt.get(x.id).c) {
        const code = seen.has(x.code) ? `${x.code.replace(/~\d+$/, '')}~${x.id}` : x.code;
        db.prepare('UPDATE company_lines SET active = 0, code = ? WHERE id = ?').run(code, x.id);
      }
      else db.prepare('DELETE FROM company_lines WHERE id = ?').run(x.id);
    }
    const upd = db.prepare(`UPDATE company_lines SET code=?, label=?, line_type=?, formula=?, head_id=?, sign=?, indent=?, bold=?,
      required=?, sort=?, active=1 WHERE id=?`);
    const ins = db.prepare(`INSERT INTO company_lines(company_id, frequency, code, label, line_type, formula, head_id, sign, indent,
      bold, required, sort) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const l of lines) {
      if (l.id) upd.run(l.code, l.label, l.line_type, l.formula, l.head_id, l.sign, l.indent, l.bold, l.required, l.sort, l.id);
      else ins.run(c.id, freq, l.code, l.label, l.line_type, l.formula, l.head_id, l.sign, l.indent, l.bold, l.required, l.sort);
    }
  });
  audit(req.user.id, 'format.save', 'node', c.id, { frequency: freq, lines: lines.length });
  const saved = activeLines(c.id, freq);
  return { lines: saved, warnings: warnings(saved, heads, freq) };
}));

// Mapping overview: which companies map which lines to each head (for the admin mapping matrix)
r.get('/mapping', requireRole('admin', 'executive'), h((req) => {
  const freq = FREQS.includes(req.query.frequency) ? req.query.frequency : 'monthly';
  const tree = loadTree();
  const companies = [...tree.byId.values()].filter((n) => n.type === 'company' && n.active)
    .map((n) => ({ id: n.id, code: n.code, name: n.name }));
  const rows = plainAll(db.prepare(`SELECT company_id, head_id, code, label, sign FROM company_lines
    WHERE frequency = ? AND active = 1 AND head_id IS NOT NULL`).all(freq));
  const lineCounts = plainAll(db.prepare(`SELECT company_id, COUNT(*) n FROM company_lines
    WHERE frequency = ? AND active = 1 GROUP BY company_id`).all(freq));
  return { companies, rows, line_counts: Object.fromEntries(lineCounts.map((x) => [x.company_id, x.n])) };
}));

export default r;
