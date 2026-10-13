import { db, tx, audit, plainAll } from './db.js';
import { actions, NEXT } from './auth.js';
import { HttpError } from './routes/util.js';

export const STATUS_LABEL = {
  new: 'Not started', draft: 'Draft', submitted: 'Submitted', company_ok: 'Company approved',
  cluster_ok: 'Cluster approved', approved: 'Approved', reopened: 'Reopened', lapsed: 'Lapsed',
};
export const LOCKED = new Set(['submitted', 'company_ok', 'cluster_ok', 'approved']);

const T = {
  week: { table: 'reports', key: 'week_key' },
  month: { table: 'month_reports', key: 'month_key' },
};

export function log(kind, cid, period, action, from, to, userId, comment) {
  const u = userId ? db.prepare('SELECT email, name FROM users WHERE id = ?').get(userId) : null;
  db.prepare('INSERT INTO workflow_log(kind, company_id, period, action, from_status, to_status, user_id, user_email, user_name, comment) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(kind, cid, period, action, from ?? null, to ?? null, userId ?? null, u?.email?.toLowerCase() ?? null, u?.name ?? null, comment ?? null);
}

export function history(kind, cid, period) {
  return plainAll(db.prepare(`SELECT w.action, w.from_status, w.to_status, w.comment, w.at, COALESCE(u.name, w.user_name) AS name, u.role FROM workflow_log w
    LEFT JOIN users u ON u.id = w.user_id WHERE w.kind = ? AND w.company_id = ? AND w.period = ? ORDER BY w.id`).all(kind, cid, period));
}

// Approve or return a submitted report
// effective: the status as the engine sees it (e.g. 'lapsed' for a week past cut-off with no row)
export function act(kind, user, cid, period, action, comment, guard, effective) {
  const { table, key } = T[kind];
  let rep = db.prepare(`SELECT * FROM ${table} WHERE company_id = ? AND ${key} = ?`).get(cid, period);
  const from = effective || rep?.status;
  if (!from) throw new HttpError(404, 'Nothing submitted');
  const allowed = actions(user, cid, from);
  if (!allowed.includes(action)) throw new HttpError(403, 'Not permitted at this stage');
  if (action === 'reopen' && !String(comment || '').trim()) throw new HttpError(400, 'Reason required');
  if (action === 'reopen' && guard) guard(rep);
  const to = action === 'approve' ? NEXT[from] : 'reopened';
  tx(() => {
    if (!rep) {
      const info = db.prepare(`INSERT INTO ${table}(company_id, ${key}, status, updated_by) VALUES (?,?,'draft',?)`).run(cid, period, user.id);
      rep = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(info.lastInsertRowid);
    }
    db.prepare(`UPDATE ${table} SET status = ?, reopened = reopened + ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(to, action === 'reopen' ? 1 : 0, user.id, rep.id);
    log(kind, cid, period, action, from, to, user.id, comment ? String(comment).trim() : null);
  });
  audit(user.id, `${kind}.${action}`, 'node', cid, { period, to });
  return to;
}
