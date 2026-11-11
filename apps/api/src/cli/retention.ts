import 'dotenv/config';
import { createPostgresPool } from '../runtime/postgres.js';
import { retentionSettings } from '../runtime/retention.js';
import { retentionOrder, runPostgresRetention } from '../repositories/postgresRetention.repository.js';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const confirmed = args.includes('--confirm-delete-expired');
const batchFlag = args.find((arg) => arg.startsWith('--max-batches='));
if (args.some((arg) => !['--apply', '--confirm-delete-expired'].includes(arg) && arg !== batchFlag) ||
    (confirmed && !apply) || (apply && !confirmed)) {
  throw new Error('Usage: db:retention [--apply --confirm-delete-expired] [--max-batches=1..100]');
}
const maxBatches = batchFlag ? Number(batchFlag.slice('--max-batches='.length)) : 20;
if (!Number.isInteger(maxBatches) || maxBatches < 1 || maxBatches > 100) {
  throw new Error('Invalid --max-batches value');
}
const days = retentionSettings().textDays;
const cutoff = new Date(Date.now() - days * 86400000);
console.log(`Text retention cutoff: ${cutoff.toISOString()} (${days} days)`);
console.log(`Tables: ${retentionOrder.join(', ')}; maximum ${maxBatches * 500} rows per table in this run.`);
if (!apply) {
  console.log('No database connection was made. Add --apply --confirm-delete-expired to delete expired rows.');
} else {
  const pool = createPostgresPool();
  try {
    const removed = await runPostgresRetention(pool, cutoff, maxBatches);
    console.log(`Deleted expired rows: ${JSON.stringify(removed)}`);
  } finally {
    await pool.end();
  }
}
