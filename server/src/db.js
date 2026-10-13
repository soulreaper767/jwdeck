import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.JW_DB || path.join(__dirname, '..', 'data', 'jw_dash.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS nodes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id  INTEGER REFERENCES nodes(id),
  type       TEXT NOT NULL CHECK (type IN ('group','cluster','company')),
  code       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  currency   TEXT NOT NULL DEFAULT 'PKR',
  sort       INTEGER NOT NULL DEFAULT 0,
  active     INTEGER NOT NULL DEFAULT 1,
  meta       TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Reporting packs and their standard lines (same for every company)
CREATE TABLE IF NOT EXISTS sections (
  code  TEXT PRIMARY KEY,
  name  TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'week' CHECK (scope IN ('week','month')),
  sort  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS lines (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  section       TEXT NOT NULL REFERENCES sections(code),
  parent_id     INTEGER REFERENCES lines(id),
  kind          TEXT NOT NULL CHECK (kind IN ('input','sku_total','opening','sum','formula','cfnet','link')),
  scope         TEXT NOT NULL DEFAULT 'week' CHECK (scope IN ('week','month')),
  cf            TEXT,
  formula       TEXT,
  nature        TEXT NOT NULL DEFAULT 'flow' CHECK (nature IN ('flow','opening','closing')),
  fmt           TEXT NOT NULL DEFAULT 'amount' CHECK (fmt IN ('amount','percent')),
  hib           INTEGER NOT NULL DEFAULT 1,
  budget        INTEGER NOT NULL DEFAULT 0,
  note_required INTEGER NOT NULL DEFAULT 0,
  is_kpi        INTEGER NOT NULL DEFAULT 0,
  system        INTEGER NOT NULL DEFAULT 0,
  sort          INTEGER NOT NULL DEFAULT 0,
  active        INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS skus (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES nodes(id),
  code       TEXT NOT NULL,
  name       TEXT NOT NULL,
  unit       TEXT NOT NULL DEFAULT 'units',
  sort       INTEGER NOT NULL DEFAULT 0,
  active     INTEGER NOT NULL DEFAULT 1,
  UNIQUE (company_id, code)
);

CREATE TABLE IF NOT EXISTS company_setup (
  company_id   INTEGER PRIMARY KEY REFERENCES nodes(id),
  start_week   TEXT NOT NULL,
  opening_cash REAL NOT NULL DEFAULT 0,
  updated_by   INTEGER,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Budgets. item = line code, or SKU:<id>:PQ|SQ|SV
-- Annual figure per fiscal year, spread over months by days; a monthly row overrides the spread.
CREATE TABLE IF NOT EXISTS budget_annual (
  company_id INTEGER NOT NULL REFERENCES nodes(id),
  fy         INTEGER NOT NULL,
  item       TEXT NOT NULL,
  value      REAL NOT NULL,
  PRIMARY KEY (company_id, fy, item)
);
CREATE TABLE IF NOT EXISTS budget_month (
  company_id INTEGER NOT NULL REFERENCES nodes(id),
  month_key  TEXT NOT NULL,
  item       TEXT NOT NULL,
  value      REAL NOT NULL,
  PRIMARY KEY (company_id, month_key, item)
);

CREATE TABLE IF NOT EXISTS reports (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES nodes(id),
  week_key   TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','company_ok','cluster_ok','approved','reopened')),
  revision   INTEGER NOT NULL DEFAULT 0,
  reopened   INTEGER NOT NULL DEFAULT 0,
  remarks    TEXT,
  updated_by INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (company_id, week_key)
);
CREATE TABLE IF NOT EXISTS report_values (
  report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  item      TEXT NOT NULL,
  month_key TEXT NOT NULL,
  value     REAL,
  PRIMARY KEY (report_id, item, month_key)
);
CREATE TABLE IF NOT EXISTS report_adj (
  report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  item      TEXT NOT NULL,
  value     REAL NOT NULL,
  reason    TEXT NOT NULL,
  PRIMARY KEY (report_id, item)
);
CREATE TABLE IF NOT EXISTS report_notes (
  report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  item      TEXT NOT NULL,
  note      TEXT NOT NULL,
  PRIMARY KEY (report_id, item)
);

-- Locked snapshots; all reporting reads from here
CREATE TABLE IF NOT EXISTS filings (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id  INTEGER NOT NULL REFERENCES reports(id),
  company_id INTEGER NOT NULL REFERENCES nodes(id),
  week_key   TEXT NOT NULL,
  revision   INTEGER NOT NULL,
  currency   TEXT NOT NULL,
  data_json  TEXT NOT NULL,
  filed_by   INTEGER,
  filed_by_email TEXT,
  filed_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (company_id, week_key, revision)
);

-- Month close: P&L inputs per company per month (everything else compiles from the weeks)
CREATE TABLE IF NOT EXISTS month_reports (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES nodes(id),
  month_key  TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','company_ok','cluster_ok','approved','reopened')),
  revision   INTEGER NOT NULL DEFAULT 0,
  reopened   INTEGER NOT NULL DEFAULT 0,
  remarks    TEXT,
  updated_by INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (company_id, month_key)
);
CREATE TABLE IF NOT EXISTS month_values (
  report_id INTEGER NOT NULL REFERENCES month_reports(id) ON DELETE CASCADE,
  item      TEXT NOT NULL,
  value     REAL,
  PRIMARY KEY (report_id, item)
);
CREATE TABLE IF NOT EXISTS month_filings (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id  INTEGER NOT NULL REFERENCES month_reports(id),
  company_id INTEGER NOT NULL REFERENCES nodes(id),
  month_key  TEXT NOT NULL,
  revision   INTEGER NOT NULL,
  data_json  TEXT NOT NULL,
  filed_by   INTEGER,
  filed_by_email TEXT,
  filed_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (company_id, month_key, revision)
);

CREATE TABLE IF NOT EXISTS workflow_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT NOT NULL CHECK (kind IN ('week','month')),
  company_id  INTEGER NOT NULL,
  period      TEXT NOT NULL,
  action      TEXT NOT NULL,
  from_status TEXT,
  to_status   TEXT,
  user_id     INTEGER,
  user_email  TEXT,
  user_name   TEXT,
  comment     TEXT,
  at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_wf ON workflow_log(kind, company_id, period);

CREATE TABLE IF NOT EXISTS fx_rates (
  currency  TEXT NOT NULL,
  month_key TEXT NOT NULL,
  rate      REAL NOT NULL,
  PRIMARY KEY (currency, month_key)
);

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin','executive','group_reviewer','cluster_reviewer','company_reviewer','company_dpo')),
  title         TEXT,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Which nodes a user covers (none = whole group for group-level roles)
CREATE TABLE IF NOT EXISTS user_scopes (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  node_id INTEGER NOT NULL REFERENCES nodes(id),
  PRIMARY KEY (user_id, node_id)
);

CREATE TABLE IF NOT EXISTS audit (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id   INTEGER,
  action    TEXT NOT NULL,
  entity    TEXT,
  entity_id INTEGER,
  detail    TEXT,
  at        TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

const DEFAULT_SETTINGS = {
  group_name: 'JW Group',
  group_currency: 'PKR',
  fiscal_year_start_month: '7',
  week_due_days: '1',
  month_due_days: '10',
  week_cutoff_hour: '11',
  tz_offset_hours: '5',
};
const insSetting = db.prepare('INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)');
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insSetting.run(k, v);

export function getSettings() {
  const out = {};
  for (const r of db.prepare('SELECT key, value FROM settings').all()) out[r.key] = r.value;
  return out;
}

// Re-entrant: nested calls join the outer transaction
let depth = 0;
export function tx(fn) {
  if (depth > 0) return fn();
  db.exec('BEGIN');
  depth++;
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  } finally {
    depth--;
  }
}

export function audit(userId, action, entity, entityId, detail) {
  db.prepare('INSERT INTO audit(user_id, action, entity, entity_id, detail) VALUES (?,?,?,?,?)')
    .run(userId ?? null, action, entity ?? null, entityId ?? null,
      detail == null ? null : typeof detail === 'string' ? detail : JSON.stringify(detail));
}

export const plain = (r) => (r ? { ...r } : r);
export const plainAll = (rows) => rows.map((r) => ({ ...r }));
