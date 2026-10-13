import { Router } from 'express';
import { db, tx, audit, plain, plainAll } from '../db.js';
import { canView, canEnter, requireRole } from '../auth.js';
import { Ctx, computeLines, headTotalsFromLines, pathOf } from '../consol.js';
import { activeLines } from './formats.js';
import * as P from '../periods.js';
import { h, bad, forbidden, notFound, num } from './util.js';

const r = Router();

function load(req) {
  const { companyId, freq, key } = req.params;
  if (!['weekly', 'monthly'].includes(freq)) throw bad('Invalid frequency');
  if (!P.isValidKey(freq, key)) throw bad('Invalid period');
  const c = db.prepare("SELECT * FROM nodes WHERE id = ? AND type = 'company'").get(Number(companyId));
  if (!c) throw notFound('Company not found');
  return { company: { ...c }, freq, key };
}

const getSub = (cid, freq, key) =>
  plain(db.prepare('SELECT * FROM submissions WHERE company_id = ? AND frequency = ? AND period_key = ?').get(cid, freq, key));

function valuesFromFiling(f) {
  if (!f) return null;
  const byId = {};
  const byCode = {};
  for (const l of f.lines) { byId[l.id] = l.value; byCode[l.code] = l.value; }
  return { revision: f.revision, filed_at: f.filed_at, byId, byCode };
}

r.get('/entry/:companyId/:freq/:key', h((req) => {
  const { company, freq, key } = load(req);
  if (!canView(req.user, company.id)) throw forbidden();
  const ctx = new Ctx();
  const sub = getSub(company.id, freq, key);
  const filing = ctx.filing(company.id, freq, key);
  const started = P.bounds(freq, key).start <= new Date();

  let lines;
  let values = {};
  let notes = {};
  if (sub && sub.status === 'filed' && filing) {
    lines = filing.lines; // show exactly what was filed
    for (const l of filing.lines) { values[l.id] = l.value; if (l.note) notes[l.id] = l.note; }
  } else {
    lines = activeLines(company.id, freq);
    if (sub) {
      for (const v of plainAll(db.prepare('SELECT * FROM submission_values WHERE submission_id = ?').all(sub.id))) {
        values[v.line_id] = v.value;
        if (v.note) notes[v.line_id] = v.note;
      }
    }
  }

  const status = sub ? sub.status : 'new';
  const prevKey = P.prev(freq, key);
  const lyKey = P.lastYear(freq, key);
  const due = P.dueDate(freq, key, ctx.settings[`${freq}_due_days`]);

  const recent = P.series(freq, P.keyForDate(freq), 10).reverse().map((k) => {
    const s = getSub(company.id, freq, k);
    const f = ctx.filing(company.id, freq, k);
    return { key: k, label: P.label(freq, k), status: s?.status === 'reopened' ? 'reopened' : f ? 'filed' : s ? 'draft' : 'missing' };
  });

  return {
    company, path: pathOf(ctx.tree, company.id), frequency: freq,
    period: P.describe(freq, key), due: due.toISOString().slice(0, 10),
    status, revision: sub?.revision || 0, remarks: sub?.remarks || '', updated_at: sub?.updated_at || null,
    editable: canEnter(req.user, company.id, ctx.tree) && status !== 'filed' && started && !!company.active,
    can_reopen: req.user.role === 'admin' && status === 'filed',
    not_started: !started,
    lines, values, notes,
    comparatives: {
      prev: { key: prevKey, label: P.label(freq, prevKey), ...(valuesFromFiling(ctx.filing(company.id, freq, prevKey)) || { missing: true }) },
      ly: { key: lyKey, label: P.label(freq, lyKey), ...(valuesFromFiling(ctx.filing(company.id, freq, lyKey)) || { missing: true }) },
      last_filed: status === 'reopened' ? valuesFromFiling(filing) : null,
    },
    recent,
  };
}));

function saveValues(req, company, freq, key) {
  if (!canEnter(req.user, company.id)) throw forbidden('You cannot enter figures for this company');
  if (!company.active) throw bad('This company is inactive');
  if (P.bounds(freq, key).start > new Date()) throw bad('This period has not started yet');
  let sub = getSub(company.id, freq, key);
  if (sub && sub.status === 'filed') throw bad('These figures are filed and locked. Ask an administrator to reopen them.');
  const lines = activeLines(company.id, freq);
  const inputIds = new Set(lines.filter((l) => l.line_type === 'input').map((l) => l.id));
  const incoming = Array.isArray(req.body?.values) ? req.body.values : [];
  return tx(() => {
    if (!sub) {
      const info = db.prepare('INSERT INTO submissions(company_id, frequency, period_key, status, updated_by) VALUES (?,?,?,?,?)')
        .run(company.id, freq, key, 'draft', req.user.id);
      sub = plain(db.prepare('SELECT * FROM submissions WHERE id = ?').get(info.lastInsertRowid));
    }
    const up = db.prepare(`INSERT INTO submission_values(submission_id, line_id, value, note) VALUES (?,?,?,?)
      ON CONFLICT(submission_id, line_id) DO UPDATE SET value = excluded.value, note = excluded.note`);
    for (const v of incoming) {
      const lid = Number(v.line_id);
      if (!inputIds.has(lid)) continue;
      up.run(sub.id, lid, num(v.value), v.note ? String(v.note).slice(0, 500) : null);
    }
    db.prepare("UPDATE submissions SET remarks = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?")
      .run(req.body?.remarks != null ? String(req.body.remarks).slice(0, 2000) : sub.remarks, req.user.id, sub.id);
    return { sub, lines };
  });
}

r.put('/entry/:companyId/:freq/:key', h((req) => {
  const { company, freq, key } = load(req);
  saveValues(req, company, freq, key);
  return { ok: true };
}));

r.post('/entry/:companyId/:freq/:key/file', h((req) => {
  const { company, freq, key } = load(req);
  const { sub, lines } = saveValues(req, company, freq, key);
  const stored = plainAll(db.prepare('SELECT * FROM submission_values WHERE submission_id = ?').all(sub.id));
  const values = new Map(stored.filter((v) => v.value != null).map((v) => [v.line_id, v.value]));
  const notes = new Map(stored.filter((v) => v.note).map((v) => [v.line_id, v.note]));

  const missing = lines.filter((l) => l.line_type === 'input' && l.required && !values.has(l.id));
  if (missing.length) throw bad(`Required lines are empty: ${missing.map((l) => l.label).join(', ')}`);
  if (!lines.some((l) => l.line_type === 'input' && values.has(l.id))) throw bad('Enter at least one figure before filing');

  const computed = computeLines(lines, values);
  const snapshot = lines.map((l) => ({
    id: l.id, code: l.code, label: l.label, line_type: l.line_type, formula: l.formula, head_id: l.head_id,
    sign: l.sign, indent: l.indent, bold: l.bold, value: l.line_type === 'header' ? null : computed.get(l.id) ?? null,
    note: notes.get(l.id) || null,
  }));
  const headTotals = headTotalsFromLines(lines, computed);
  const lastRev = db.prepare('SELECT MAX(revision) r FROM filings WHERE company_id = ? AND frequency = ? AND period_key = ?')
    .get(company.id, freq, key).r || 0;
  const revision = lastRev + 1;

  tx(() => {
    db.prepare(`INSERT INTO filings(submission_id, company_id, frequency, period_key, revision, currency, lines_json, heads_json, remarks, filed_by)
      VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(sub.id, company.id, freq, key, revision, company.currency, JSON.stringify(snapshot), JSON.stringify(headTotals),
        req.body?.remarks ?? sub.remarks ?? null, req.user.id);
    db.prepare("UPDATE submissions SET status = 'filed', revision = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?")
      .run(revision, req.user.id, sub.id);
  });
  audit(req.user.id, revision > 1 ? 'entry.refile' : 'entry.file', 'node', company.id, { frequency: freq, period: key, revision });
  return { ok: true, revision };
}));

r.post('/entry/:companyId/:freq/:key/reopen', requireRole('admin'), h((req) => {
  const { company, freq, key } = load(req);
  const reason = String(req.body?.reason || '').trim();
  if (!reason) throw bad('Give a reason for reopening');
  const sub = getSub(company.id, freq, key);
  if (!sub || sub.status !== 'filed') throw bad('Only filed figures can be reopened');
  db.prepare("UPDATE submissions SET status = 'reopened', updated_by = ?, updated_at = datetime('now') WHERE id = ?").run(req.user.id, sub.id);
  audit(req.user.id, 'entry.reopen', 'node', company.id, { frequency: freq, period: key, reason, revision: sub.revision });
  return { ok: true };
}));

// Filing history for a company/period (all locked revisions)
r.get('/entry/:companyId/:freq/:key/history', h((req) => {
  const { company, freq, key } = load(req);
  if (!canView(req.user, company.id)) throw forbidden();
  const rows = plainAll(db.prepare(`SELECT f.id, f.revision, f.filed_at, f.remarks, u.name AS filed_by, f.lines_json
    FROM filings f LEFT JOIN users u ON u.id = f.filed_by
    WHERE f.company_id = ? AND f.frequency = ? AND f.period_key = ? ORDER BY f.revision DESC`).all(company.id, freq, key));
  const reopens = plainAll(db.prepare(`SELECT a.at, a.detail, u.name FROM audit a LEFT JOIN users u ON u.id = a.user_id
    WHERE a.action = 'entry.reopen' AND a.entity_id = ? ORDER BY a.at DESC`).all(company.id))
    .map((a) => ({ ...a, detail: JSON.parse(a.detail || '{}') }))
    .filter((a) => a.detail.frequency === freq && a.detail.period === key);
  return { filings: rows.map(({ lines_json, ...x }) => ({ ...x, lines: JSON.parse(lines_json) })), reopens };
}));

export default r;
