/**
 * Supabase Storage-based vault backup system.
 * Replaces the GAS (Google Apps Script) cloud vault with direct Supabase Storage.
 * Files stored under: vault-backups/{user_id}/{timestamp}-{label}.json
 */

import { supabase } from '@/integrations/supabase/client';

const BUCKET = 'vault-backups';
const MAX_BACKUPS = 30;

export interface VaultBackup {
  id: string;
  name: string;
  label: string;
  createdAt: string;
  sizeBytes: number;
}

function sanitizeLabel(label: string): string {
  return label.replace(/[^a-zA-Z0-9_\-\u0600-\u06FF ]/g, '').trim().slice(0, 40) || 'backup';
}

/**
 * Upload a vault backup to Supabase Storage.
 */
export async function uploadVaultBackup(
  userId: string,
  state: Record<string, unknown>,
  label: string,
): Promise<{ ok: boolean; error?: string }> {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const safeLabel = sanitizeLabel(label);
  const fileName = `${userId}/${ts}_${safeLabel}.json`;

  const blob = new Blob([JSON.stringify(state)], { type: 'application/json' });

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(fileName, blob, { upsert: false });

  if (error) return { ok: false, error: error.message };

  // Prune old backups beyond MAX_BACKUPS
  try {
    await pruneOldBackups(userId);
  } catch {
    // Non-critical — don't fail the backup
  }

  return { ok: true };
}

/**
 * List all vault backups for a user, newest first.
 */
export async function listVaultBackups(userId: string): Promise<VaultBackup[]> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .list(userId, { sortBy: { column: 'created_at', order: 'desc' } });

  if (error || !data) return [];

  return data
    .filter(f => f.name.endsWith('.json'))
    .map(f => {
      // Parse label from filename: {timestamp}_{label}.json
      const nameWithoutExt = f.name.replace('.json', '');
      const underscoreIdx = nameWithoutExt.indexOf('_');
      const label = underscoreIdx >= 0 ? nameWithoutExt.slice(underscoreIdx + 1) : nameWithoutExt;

      return {
        id: f.id ?? f.name,
        name: f.name,
        label: decodeURIComponent(label),
        createdAt: f.created_at ?? '',
        sizeBytes: (f.metadata as Record<string, unknown>)?.size as number ?? 0,
      };
    });
}

/**
 * Download and parse a vault backup.
 */
export async function downloadVaultBackup(
  userId: string,
  fileName: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .download(`${userId}/${fileName}`);

  if (error || !data) return null;

  try {
    const text = await data.text();
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Delete a vault backup.
 */
export async function deleteVaultBackup(
  userId: string,
  fileName: string,
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.storage
    .from(BUCKET)
    .remove([`${userId}/${fileName}`]);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Keep only the newest MAX_BACKUPS files.
 */
async function pruneOldBackups(userId: string): Promise<void> {
  const backups = await listVaultBackups(userId);
  if (backups.length <= MAX_BACKUPS) return;

  const toDelete = backups.slice(MAX_BACKUPS).map(b => `${userId}/${b.name}`);
  if (toDelete.length > 0) {
    await supabase.storage.from(BUCKET).remove(toDelete);
  }
}

/**
 * Format bytes to human-readable string.
 */
export function fmtBytes(b: number): string {
  const n = +b || 0;
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}
