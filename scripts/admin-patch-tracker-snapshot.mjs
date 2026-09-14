#!/usr/bin/env node
// Safe path for any out-of-band correction to a merchant's tracker_snapshots
// row (the JSONB blob behind trades, customerLoans, cashLedger, etc). Direct
// SQL UPDATEs against this table are dangerous: the app is local-first, so a
// merchant device that still has the pre-patch data cached in localStorage
// will read-merge-write its stale copy right back over the fix the next time
// it autosaves. save_tracker_snapshot_if_newer only accepts a write whose
// write_generation is >= the row's current value, so this script always
// backs up the row, applies the patch, and pushes write_generation forward
// by a wide margin — any stale device's next save then gets rejected by that
// RPC until it reloads from cloud, which resyncs its local generation
// counter (see syncTrackerWriteGenerationToAtLeast in src/lib/tracker-backup.ts)
// and only then lets it save again, on top of the corrected state.
//
// The jump defaults to 1,000,000. A client's local write_generation counter
// increments by 1 on every autosave, so a merchant who has been using the app
// daily for months can already be at a counter in the hundreds or thousands —
// a small jump (e.g. +1000) is not a safe margin and has silently lost data
// to exactly this race in production. Do not lower this without a specific
// reason; if anything, prefer raising it further.
//
// Usage:
//   node scripts/admin-patch-tracker-snapshot.mjs \
//     --user-id <uuid> \
//     --patch ./my-patch.mjs \
//     [--backup-dir ./tracker-snapshot-backups] \
//     [--generation-jump 1000000] \
//     [--dry-run]
//
// The patch module's default export is (state) => state — a pure function
// that returns the new state object (or mutates and returns it). Anything it
// does not touch is left exactly as-is, so a patch that only needs to fix
// one customer's loans should not rebuild the rest of the object.
//
// Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment —
// the anon/publishable key cannot write another user's row, and should not
// be used for admin corrections even for your own row.

import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

function parseArgs(argv) {
  const args = { backupDir: './tracker-snapshot-backups', generationJump: 1_000_000, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--user-id') args.userId = argv[++i];
    else if (a === '--patch') args.patchPath = argv[++i];
    else if (a === '--backup-dir') args.backupDir = argv[++i];
    else if (a === '--generation-jump') args.generationJump = Number(argv[++i]);
    else if (a === '--dry-run') args.dryRun = true;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.userId || !args.patchPath) {
    console.error('Usage: node scripts/admin-patch-tracker-snapshot.mjs --user-id <uuid> --patch <file.mjs> [--dry-run]');
    process.exit(1);
  }

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running this script.');
    process.exit(1);
  }
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  const patchModule = await import(path.resolve(args.patchPath));
  const applyPatch = patchModule.default;
  if (typeof applyPatch !== 'function') {
    console.error(`${args.patchPath} must default-export a function (state) => state`);
    process.exit(1);
  }

  const { data: row, error: readError } = await supabase
    .from('tracker_snapshots')
    .select('user_id, state, write_generation, updated_at, is_cleared')
    .eq('user_id', args.userId)
    .maybeSingle();
  if (readError) throw readError;
  if (!row) {
    console.error(`No tracker_snapshots row for user_id ${args.userId}`);
    process.exit(1);
  }

  fs.mkdirSync(args.backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(args.backupDir, `${args.userId}-${stamp}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(row, null, 2));
  console.log(`Backed up current row to ${backupPath}`);

  const nextState = await applyPatch(structuredClone(row.state));
  const nextGeneration = (row.write_generation || 0) + args.generationJump;

  console.log(`Current write_generation: ${row.write_generation}. New write_generation: ${nextGeneration}.`);

  if (args.dryRun) {
    const previewPath = path.join(args.backupDir, `${args.userId}-${stamp}-preview.json`);
    fs.writeFileSync(previewPath, JSON.stringify(nextState, null, 2));
    console.log(`Dry run only — no write performed. Patched state written to ${previewPath} for review.`);
    return;
  }

  const { data: applied, error: writeError } = await supabase.rpc('save_tracker_snapshot_if_newer', {
    _user_id: args.userId,
    _state: nextState,
    _updated_at: new Date().toISOString(),
    _write_generation: nextGeneration,
    _is_cleared: row.is_cleared ?? false,
  });
  if (writeError) throw writeError;
  if (!applied) {
    console.error('save_tracker_snapshot_if_newer returned false — another write raced ahead of this one. Nothing was changed; re-run against the current row.');
    process.exit(1);
  }

  console.log(`Patch applied for user_id ${args.userId}. Any device with a stale local copy will have its next autosave rejected until it reloads from cloud — the merchant may need to refresh/reopen the app once for the fix to stick everywhere.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
