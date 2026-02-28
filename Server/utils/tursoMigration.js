/**
 * tursoMigration.js
 * ──────────────────
 * Run this script ONCE to create the certificate_registry table in Turso.
 *
 * Usage (from the Server/ directory):
 *   node utils/tursoMigration.js
 *
 * Prerequisites: TURSO_DB_URL and TURSO_AUTH_TOKEN must be set in Server/.env
 */

require('dotenv').config();

const SQL = `
  CREATE TABLE IF NOT EXISTS certificate_registry (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    reference_number TEXT    NOT NULL UNIQUE,
    certificate_type TEXT    NOT NULL,
    recipient_name   TEXT    NOT NULL,
    details          TEXT    NOT NULL DEFAULT '{}',
    issued_at        TEXT    NOT NULL,
    created_at       TEXT    DEFAULT (datetime('now'))
  )
`;

async function migrate() {
  const rawUrl    = process.env.TURSO_DB_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (!rawUrl || !authToken) {
    console.error('❌  TURSO_DB_URL and TURSO_AUTH_TOKEN must be set in .env');
    process.exit(1);
  }

  const dbUrl = rawUrl.replace(/^libsql:/, 'https:');

  const body = {
    requests: [
      { type: 'execute', stmt: { sql: SQL.trim(), args: [] } },
      { type: 'close' },
    ],
  };

  console.log('Running Turso migration for certificate_registry …');

  const response = await fetch(`${dbUrl}/v2/pipeline`, {
    method : 'POST',
    headers: {
      Authorization  : `Bearer ${authToken}`,
      'Content-Type' : 'application/json',
    },
    body: JSON.stringify(body),
  });

  const json = await response.json();

  if (!response.ok || json?.results?.[0]?.type === 'error') {
    console.error('❌  Migration failed:', JSON.stringify(json, null, 2));
    process.exit(1);
  }

  console.log('✅  Table certificate_registry is ready.');
}

migrate().catch(err => {
  console.error('Unexpected error:', err.message);
  process.exit(1);
});
