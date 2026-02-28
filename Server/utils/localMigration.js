/**
 * localMigration.js
 * ─────────────────
 * Creates the certificate_registry table in the local MariaDB database,
 * mirroring the same table that exists in Turso (used by the Vercel verifier).
 *
 * Usage (from the Server/ directory):
 *   node utils/localMigration.js
 *
 * Prerequisites: DB_HOST, DB_USER, DB_PASSWORD, DB_DATABASE must be set in Server/.env
 */

require('dotenv').config();
const dbPool = require('../db');

const SQL = `
  CREATE TABLE IF NOT EXISTS certificate_registry (
    id               INT          AUTO_INCREMENT PRIMARY KEY,
    reference_number VARCHAR(255) NOT NULL UNIQUE,
    certificate_type VARCHAR(100) NOT NULL,
    recipient_name   VARCHAR(255) NOT NULL,
    details          TEXT         NOT NULL DEFAULT '{}',
    issued_at        VARCHAR(50)  NOT NULL,
    created_at       DATETIME     DEFAULT CURRENT_TIMESTAMP
  )
`;

async function migrate() {
  try {
    await dbPool.query(SQL);
    console.log('✅  Table certificate_registry is ready in local MariaDB.');
  } catch (err) {
    console.error('❌  Migration failed:', err.message);
    process.exit(1);
  } finally {
    await dbPool.end().catch(() => {});
  }
}

migrate();
