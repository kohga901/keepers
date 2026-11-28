import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { runBatch, cursorId } from '../src/catalog.mjs';

// This entry point always passes dryRun:true, even when DRY_RUN=false is in the environment.
const options = {};
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i];
  if (!['--env-file', '--limit', '--after-id', '--output'].includes(key) || !process.argv[i + 1]) {
    console.error('Usage: npm run dry-run -- [--env-file PATH] [--limit 1..50] [--after-id ID] [--output PATH]');
    process.exit(1);
  }
  options[key] = process.argv[i + 1];
}

try {
  if (options['--env-file']) process.loadEnvFile(resolve(options['--env-file']));
  const report = await runBatch({
    SUPABASE_URL: process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL,
    SUPABASE_KEY: process.env.SUPABASE_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_KEY,
    FREE_TIER: process.env.FREE_TIER,
    BROWSER_FALLBACK_LIMIT: process.env.BROWSER_FALLBACK_LIMIT ?? '0',
    CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID,
    CLOUDFLARE_BROWSER_TOKEN: process.env.CLOUDFLARE_BROWSER_TOKEN,
  }, { dryRun: true, afterId: cursorId(options['--after-id'] ?? '0'), limit: Number(options['--limit'] ?? (process.env.FREE_TIER === 'true' ? 1 : 10)) });
  const output = resolve(options['--output'] ?? `reports/dry-run-${report.started_at.replaceAll(':', '-')}.json`);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ mode: report.mode, summary: report.summary, warning: report.warning, next_after_id: report.next_after_id, report: output }, null, 2));
  if (report.warning) process.exitCode = 2;
} catch (error) {
  // Database responses and fetch exceptions can contain credentials or infrastructure details.
  const safe = /^(invalid_after_id|invalid_batch_size|invalid_supabase_url|missing_supabase_key|supabase_http_\d+|invalid_supabase_response)$/.test(error.message);
  console.error(safe ? error.message : 'Dry run failed. Check the env file, Supabase credentials and network access.');
  process.exitCode = 1;
}
