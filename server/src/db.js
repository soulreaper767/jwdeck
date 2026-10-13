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
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- Company tree: group -> clusters (nestable) -> companies (leaves that report)
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

-- Group-wide standard heads used for consolidation
CREATE TABLE IF NOT EXISTS heads (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id        INTEGER REFERENCES heads(id),
  code             TEXT NOT NULL UNIQUE,
  name             TEXT NOT NULL,
  statement        TEXT NOT NULL DEFAULT 'PL' CHECK (statement IN ('PL','BS','CF','KPI')),
  head_type        TEXT NOT NULL DEFAULT 'input' CHECK (head_type IN ('section','input','group','formula')),
  nature           TEXT NOT NULL DEFAULT 'flow' CHECK (nature IN ('flow','balance','average')),
  formula          TEXT,
  fmt              TEXT NOT NULL DEFAULT 'amount' CHECK (fmt IN ('amount','percent','number')),
  higher_is_better INTEGER NOT NULL DEFAULT 1,
  frequency        TEXT NOT NULL DEFAULT 'both' CHECK (frequency IN ('both','weekly','monthly')),
  is_kpi           INTEGER NOT NULL DEFAULT 0,
  sort             INTEGER NOT NULL DEFAULT 0,
  active           INTEGER NOT NULL DEFAULT 1
);

-- Each company's own reporting format (per frequency), mapped to standard heads
CREATE TABLE IF NOT EXISTS company_lines (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES nodes(id),
  frequency  TEXT NOT NULL CHECK (frequency IN ('weekly','monthly')),
  code       TEXT NOT NULL,
  label      TEXT NOT NULL,
  line_type  TEXT NOT NULL DEFAULT 'input' CHECK (line_type IN ('header','input','formula')),
  formula    TEXT,
  head_id    INTEGER REFERENCES heads(id),
  sign       INTEGER NOT NULL DEFAULT 1,
  indent     INTEGER NOT NULL DEFAULT 0,
  bold       INTEGER NOT NULL DEFAULT 0,
  required   INTEGER NOT NULL DEFAULT 0,
  sort       INTEGER NOT NULL DEFAULT 0,
  active     INTEGER NOT NULL DEFAULT 1,
  UNIQUE (company_id, frequency, code)
);

-- Working copy of a company's figures for a period
CREATE TABLE IF NOT EXISTS submissions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id   INTEGER NOT NULL REFERENCES nodes(id),
  frequency    TEXT NOT NULL CHECK (frequency IN ('weekly','monthly')),
  period_key   TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','filed','reopened')),
  revision     INTEGER NOT NULL DEFAULT 0,
  remarks      TEXT,
  updated_by   INTEGER,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (company_id, frequency, period_key)
);

CREATE TABLE IF NOT EXISTS submission_values (
  submission_id INTEGER NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  line_id       INTEGER NOT NULL REFERENCES company_lines(id),
  value         REAL,
  note          TEXT,
  PRIMARY KEY (submission_id, line_id)
);

-- Immutable locked snapshots. Consolidation + comparatives read only from here.
CREATE TABLE IF NOT EXISTS filings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id INTEGER NOT NULL REFERENCES submissions(id),
  company_id    INTEGER NOT NULL REFERENCES nodes(id),
  frequency     TEXT NOT NULL,
  period_key    TEXT NOT NULL,
  revision      INTEGER NOT NULL,
  currency      TEXT NOT NULL,
  lines_json    TEXT NOT NULL,
  heads_json    TEXT NOT NULL,
  remarks       TEXT,
  filed_by      INTEGER,
  filed_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (company_id, frequency, period_key, revision)
);
CREATE INDEX IF NOT EXISTS ix_filings_lookup ON filings(company_id, frequency, period_key, revision DESC);

CREATE TABLE IF NOT EXISTS fx_rates (
  currency   TEXT NOT NULL,
  month_key  TEXT NOT NULL,
  rate       REAL NOT NULL,
  PRIMARY KEY (currency, month_key)
);

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin','executive','cluster','company')),
  node_id       INTEGER REFERENCES nodes(id),
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
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
  weekly_due_days: '3',
  monthly_due_days: '10',
};
const insSetting = db.prepare('INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)');
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insSetting.run(k, v);

export function getSettings() {
  const out = {};
  for (const r of db.prepare('SELECT key, value FROM settings').all()) out[r.key] = r.value;
  return out;
}

export function tx(fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function audit(userId, action, entity, entityId, detail) {
  db.prepare('INSERT INTO audit(user_id, action, entity, entity_id, detail) VALUES (?,?,?,?,?)')
    .run(userId ?? null, action, entity ?? null, entityId ?? null,
      detail == null ? null : typeof detail === 'string' ? detail : JSON.stringify(detail));
}

// node:sqlite returns null-prototype rows; normalise to plain objects for JSON.
export const plain = (r) => (r ? { ...r } : r);
export const plainAll = (rows) => rows.map((r) => ({ ...r }));
