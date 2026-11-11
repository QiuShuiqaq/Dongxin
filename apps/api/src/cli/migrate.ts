import 'dotenv/config';
import { applyMigrations, loadMigrations } from '../runtime/migrations.js';
import { createPostgresPool } from '../runtime/postgres.js';

const migrations = await loadMigrations();
if (!process.argv.includes('--apply')) {
  for (const migration of migrations) console.log(`${migration.version} ${migration.sha256}`);
  console.log('No database connection was made. Pass --apply to run these migrations.');
} else {
  const pool = createPostgresPool();
  try {
    const applied = await applyMigrations(pool, migrations);
    console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database schema is current.');
  } finally {
    await pool.end();
  }
}
