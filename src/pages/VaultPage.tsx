import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { Camera, Download, Upload, Trash2, RefreshCw, FileJson, FileSpreadsheet, FileText, AlertTriangle, CheckCircle2, XCircle, Loader2, Cloud } from 'lucide-react';
import { useT, getCurrencyLabel } from '@/lib/i18n';
import { useTheme } from '@/lib/theme-context';
import {
  clearTrackerStorage,
  findTrackerStorageKey,
  getCurrentTrackerState,
  hasMeaningfulTrackerData,
  loadAutoBackupFromStorage,
  normalizeImportedTrackerState,
  saveAutoBackupToStorage,
} from '@/lib/tracker-backup';
import { saveTrackerStateNow, loadTrackerStateFromCloud } from '@/lib/tracker-sync';
import type { TrackerState } from '@/lib/tracker-helpers';
import { mergeLocalAndCloud } from '@/lib/tracker-state';
import {
  gasLoadConfig, gasSaveConfig, gasPost, getGasUrl,
  getGasLastSync, setGasLastSync, fmtBytes as gasFmtBytes,
  isCloudLoggedIn, getGasSession, clearCloudSession,
  autoAuthenticateCloudWithDetails,
  type CloudVersion,
} from '@/lib/gas-cloud';
import {
  uploadVaultBackup, listVaultBackups, downloadVaultBackup,
  deleteVaultBackup, fmtBytes as sbFmtBytes,
  type VaultBackup,
} from '@/lib/supabase-vault';
import { useAuth } from '@/features/auth/auth-context';

/* ── IDB Vault (Ring 1) ── */
interface Snapshot {
  id: string;
  ts: number;
  label: string;
  sizeKB: number;
  checksum: string;
  tradeCount: number;
  batchCount: number;
  state: Record<string, unknown>;
}

function fnv1a(str: string): string {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h = (h ^ str.charCodeAt(i)) >>> 0;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).toUpperCase();
}

function openIDB(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const req = indexedDB.open('p2p_tracker_vault', 1);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains('snapshots')) db.createObjectStore('snapshots', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('metadata')) db.createObjectStore('metadata', { keyPath: 'key' });
    };
    req.onsuccess = (e) => res((e.target as IDBOpenDBRequest).result);
    req.onerror = () => rej(new Error('IndexedDB not available'));
  });
}

async function idbList(): Promise<Snapshot[]> {
  const db = await openIDB();
  return new Promise((res) => {
    const tx = db.transaction('snapshots', 'readonly');
    const req = tx.objectStore('snapshots').getAll();
    req.onsuccess = () => {
      const snaps = (req.result || []).sort((a: Snapshot, b: Snapshot) => b.ts - a.ts);
      res(snaps);
    };
    req.onerror = () => res([]);
  });
}

async function idbSave(state: Record<string, unknown>, label: string): Promise<void> {
  const db = await openIDB();
  const str = JSON.stringify(state || {});
  const snap: Snapshot = {
    id: 'snap_' + Date.now(),
    ts: Date.now(),
    label: label || 'Manual',
    sizeKB: Math.max(1, Math.ceil(str.length / 1024)),
    checksum: fnv1a(str),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tradeCount: Array.isArray((state as any)?.trades) ? (state as any).trades.length : 0,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    batchCount: Array.isArray((state as any)?.batches) ? (state as any).batches.length : 0,
    state,
  };
  return new Promise((res, rej) => {
    const tx = db.transaction('snapshots', 'readwrite');
    tx.objectStore('snapshots').put(snap);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(new Error('Failed to save'));
  });
}

async function idbGet(id: string): Promise<Snapshot | null> {
  const db = await openIDB();
  return new Promise((res) => {
    const tx = db.transaction('snapshots', 'readonly');
    const req = tx.objectStore('snapshots').get(id);
    req.onsuccess = () => res(req.result || null);
    req.onerror = () => res(null);
  });
}

async function idbDelete(id: string): Promise<void> {
  const db = await openIDB();
  return new Promise((res, rej) => {
    const tx = db.transaction('snapshots', 'readwrite');
    tx.objectStore('snapshots').delete(id);
    tx.oncomplete = () => res();
    tx.onerror = () => rej();
  });
}

function downloadBlob(content: string, filename: string, mime = 'application/json') {
  const blob = new Blob([content], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

function getCurrentState(): Record<string, unknown> {
  return getCurrentTrackerState(localStorage);
}

async function resolveVaultState(): Promise<Record<string, unknown>> {
  const local = getCurrentState();
  if (hasMeaningfulTrackerData(local)) return local;

  try {
    const cloud = await loadTrackerStateFromCloud();
    const merged = mergeLocalAndCloud(local as Partial<TrackerState> | null, cloud);
    if (merged && hasMeaningfulTrackerData(merged)) return merged;
    if (cloud && hasMeaningfulTrackerData(cloud)) return cloud;
  } catch {
    // Fall through to the local-only state below.
  }

  return local;
}

function countVaultItems(state: Record<string, unknown>): number {
  const collections = ['batches', 'trades', 'customers', 'suppliers', 'cashAccounts', 'cashLedger', 'cashHistory'] as const;
  return collections.reduce((sum, key) => sum + (Array.isArray(state[key]) ? state[key].length : 0), 0);
}

async function clearTrackerVaultDb(): Promise<void> {
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('p2p_tracker_vault');
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

export default function VaultPage() {
  const t = useT();
  const navigate = useNavigate();
  const { email, userId, merchantProfile } = useAuth();
  const { settings } = useTheme();
  const baseFiat = settings.baseFiatCurrency || 'QAR';

  const [snaps, setSnaps] = useState<Snapshot[]>([]);
  const [snapDesc, setSnapDesc] = useState('');
  const [loading, setLoading] = useState(false);
  const [autoBackup, setAutoBackup] = useState(() => loadAutoBackupFromStorage(localStorage));
  const importInputRef = useRef<HTMLInputElement>(null);
  const [importStatus, setImportStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [importMsg, setImportMsg] = useState('');
  const [exportStatus, setExportStatus] = useState<'idle' | 'success'>('idle');

  // ── Ring 2 Cloud Vault State (Supabase Storage) ──
  const [cloudBackups, setCloudBackups] = useState<VaultBackup[]>([]);
  const [cloudLoading, setCloudLoading] = useState(false);
  const [cloudLabel, setCloudLabel] = useState('');

  const loadCloudBackups = useCallback(async () => {
    if (!userId) return;
    setCloudLoading(true);
    try {
      const backups = await listVaultBackups(userId);
      setCloudBackups(backups);
    } catch {
      setCloudBackups([]);
    } finally {
      setCloudLoading(false);
    }
  }, [userId]);

  // Auto-load cloud backups on mount
  useEffect(() => {
    void loadCloudBackups();
  }, [loadCloudBackups]);

  const loadSnaps = useCallback(async () => {
    try {
      const list = await idbList();
      setSnaps(list);
    } catch {
      setSnaps([]);
    }
  }, []);

  useEffect(() => { loadSnaps(); }, [loadSnaps]);

  const takeSnapshot = async () => {
    if (!snapDesc.trim()) {
      toast.error(t.lang === 'ar' ? 'أضف وصفاً للنسخة الاحتياطية' : 'Add a description for the snapshot');
      return;
    }
    setLoading(true);
    try {
      const state = await resolveVaultState();
      await idbSave(state, snapDesc.trim());
      setSnapDesc('');
      toast.success(t.lang === 'ar' ? '📸 تم حفظ النسخة' : '📸 Snapshot saved');
      await loadSnaps();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      toast.error((t.lang === 'ar' ? 'فشل: ' : 'Failed: ') + (e.message || 'error'));
    } finally {
      setLoading(false);
    }
  };

  const restoreSnap = async (id: string) => {
    if (!confirm(t.lang === 'ar' ? 'استعادة هذه النسخة؟ سيتم استبدال البيانات الحالية.' : 'Restore this local snapshot? Current data will be overwritten.')) return;
    const snap = await idbGet(id);
    if (!snap?.state) { toast.error(t.lang === 'ar' ? 'النسخة غير موجودة' : 'Snapshot not found'); return; }
    try {
      const sk = findTrackerStorageKey(localStorage);
      localStorage.removeItem('tracker_data_cleared');
      localStorage.setItem(sk, JSON.stringify(snap.state));
      await saveTrackerStateNow(snap.state as unknown as TrackerState);
      toast.success(t.lang === 'ar' ? '✓ تمت الاستعادة' : '✓ Restored from local snapshot');
      window.location.reload();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      toast.error((t.lang === 'ar' ? 'فشلت الاستعادة: ' : 'Restore failed: ') + e.message);
    }
  };

  const exportSnap = async (id: string) => {
    const snap = await idbGet(id);
    if (!snap?.state) { toast.error(t.lang === 'ar' ? 'النسخة غير موجودة' : 'Snapshot not found'); return; }
    const label = (snap.label || 'snapshot').replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 40);
    const d = new Date(snap.ts);
    const fname = `snapshot-${d.toISOString().slice(0, 19).replace(/[:T]/g, '-')}-${label}.json`;
    downloadBlob(JSON.stringify(snap.state, null, 2), fname);
    toast.success(t.lang === 'ar' ? 'تم تصدير النسخة' : 'Exported snapshot');
  };

  const deleteSnap = async (id: string) => {
    if (!confirm(t.lang === 'ar' ? 'حذف هذه النسخة؟' : 'Delete this snapshot?')) return;
    await idbDelete(id);
    toast(t.lang === 'ar' ? 'تم حذف النسخة' : 'Snapshot deleted');
    await loadSnaps();
  };

  const handleAutoBackupToggle = (v: boolean) => {
    setAutoBackup(v);
    saveAutoBackupToStorage(localStorage, v);
    toast(v ? (t.lang === 'ar' ? 'النسخ التلقائي مفعّل' : 'Auto-backup ON') : (t.lang === 'ar' ? 'النسخ التلقائي معطّل' : 'Auto-backup OFF'));
  };

  // Cloud auth is automatic via Supabase session — no manual login needed

  const cloudBackupNow = async () => {
    if (!userId) { toast.error(t.lang === 'ar' ? 'يجب تسجيل الدخول' : 'Must be logged in'); return; }
    setCloudLoading(true);
    try {
      const state = await resolveVaultState();
      const res = await uploadVaultBackup(userId, state, cloudLabel || 'Manual backup');
      if (!res.ok) throw new Error(res.error || 'Upload failed');
      setCloudLabel('');
      toast.success(t.lang === 'ar' ? '☁ تم النسخ الاحتياطي' : '☁ Backed up · ' + new Date().toLocaleTimeString());
      await loadCloudBackups();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Backup failed';
      toast.error(msg);
    } finally {
      setCloudLoading(false);
    }
  };

  const restoreCloudBackup = async (fileName: string) => {
    if (!userId) return;
    if (!confirm(t.lang === 'ar' ? 'استعادة هذه النسخة السحابية؟ سيتم استبدال جميع البيانات المحلية.' : 'Restore this cloud backup? This will overwrite ALL local data.')) return;
    setCloudLoading(true);
    try {
      const state = await downloadVaultBackup(userId, fileName);
      if (!state) { toast.error(t.lang === 'ar' ? 'لا يوجد محتوى' : 'No backup content'); return; }
      const sk = findTrackerStorageKey(localStorage);
      localStorage.removeItem('tracker_data_cleared');
      localStorage.setItem(sk, JSON.stringify(state));
      await saveTrackerStateNow(state as unknown as TrackerState);
      toast.success(t.lang === 'ar' ? '✓ تمت الاستعادة من السحابة' : '✓ Restored from cloud');
      window.location.reload();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Restore failed';
      toast.error(msg);
    } finally {
      setCloudLoading(false);
    }
  };

  const deleteCloudBackup = async (fileName: string) => {
    if (!userId) return;
    if (!confirm(t.lang === 'ar' ? 'حذف هذه النسخة السحابية؟' : 'Delete this cloud backup?')) return;
    const res = await deleteVaultBackup(userId, fileName);
    if (res.ok) {
      toast(t.lang === 'ar' ? 'تم حذف النسخة' : 'Backup deleted');
      await loadCloudBackups();
    } else {
      toast.error(res.error || 'Delete failed');
    }
  };

  const [previewData, setPreviewData] = useState<{ label: string; summary: string } | null>(null);

  const previewCloudBackup = async (fileName: string, label: string) => {
    if (!userId) return;
    setCloudLoading(true);
    try {
      const state = await downloadVaultBackup(userId, fileName);
      if (!state) { toast.error('No content'); return; }
      const collections = ['batches', 'trades', 'customers', 'suppliers', 'cashAccounts', 'cashLedger'] as const;
      const lines = collections
        .map(k => {
          const arr = Array.isArray((state as Record<string, unknown>)[k]) ? (state as Record<string, unknown>)[k] as unknown[] : [];
          return arr.length > 0 ? `${k}: ${arr.length}` : null;
        })
        .filter(Boolean);
      const total = lines.length > 0 ? lines.join('\n') : (t.lang === 'ar' ? 'لا توجد بيانات' : 'No data');
      setPreviewData({ label, summary: total });
    } catch {
      toast.error('Preview failed');
    } finally {
      setCloudLoading(false);
    }
  };

  const extractCloudBackup = async (fileName: string) => {
    if (!userId) return;
    setCloudLoading(true);
    try {
      const state = await downloadVaultBackup(userId, fileName);
      if (!state) { toast.error('No content'); return; }
      const fname = `cloud-backup-${fileName}`;
      downloadBlob(JSON.stringify(state, null, 2), fname);
      toast.success(t.lang === 'ar' ? 'تم التصدير' : 'Extracted');
    } catch {
      toast.error('Extract failed');
    } finally {
      setCloudLoading(false);
    }
  };

  const handleCloudImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const data = JSON.parse(reader.result as string);
        if (!userId) return;
        const res = await uploadVaultBackup(userId, data, f.name.replace('.json', ''));
        if (res.ok) {
          toast.success(t.lang === 'ar' ? 'تم رفع الملف' : 'File uploaded');
          await loadCloudBackups();
        } else {
          toast.error(res.error || 'Upload failed');
        }
      } catch {
        toast.error('Invalid JSON file');
      }
    };
    reader.readAsText(f);
    e.target.value = '';
  };

  const cloudImportRef = useRef<HTMLInputElement>(null);




  // Data export helpers
  const exportJSON = async () => {
    const state = await resolveVaultState();
    const fname = `p2p-tracker-${new Date().toISOString().slice(0, 10)}.json`;
    downloadBlob(JSON.stringify(state, null, 2), fname);
    setExportStatus('success');
    toast.success(t.lang === 'ar' ? 'تم تصدير JSON' : 'JSON exported');
    setTimeout(() => setExportStatus('idle'), 3000);
  };

  const exportCSV = async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const state = await resolveVaultState() as any;
    const trades = Array.isArray(state.trades) ? state.trades : [];
    const batches = Array.isArray(state.batches) ? state.batches : [];
    const customers = Array.isArray(state.customers) ? state.customers : [];
    const suppliers = Array.isArray(state.suppliers) ? state.suppliers : [];
    const cashAccounts = Array.isArray(state.cashAccounts) ? state.cashAccounts : [];
    const cashLedger = Array.isArray(state.cashLedger) ? state.cashLedger : [];
    const cashHistory = Array.isArray(state.cashHistory) ? state.cashHistory : [];

    const hasData =
      trades.length > 0 ||
      batches.length > 0 ||
      customers.length > 0 ||
      suppliers.length > 0 ||
      cashAccounts.length > 0 ||
      cashLedger.length > 0 ||
      cashHistory.length > 0;

    if (!hasData) {
      toast.error(t.lang === 'ar' ? 'لا توجد بيانات للتصدير' : 'No data to export');
      return;
    }

    const headers = ['collection', 'id', 'ts', 'label', 'amount_or_qty', 'rate_or_type', 'fee_or_direction', 'note', 'status', 'payload'];
    const rows: string[] = [];

    if (trades.length > 0) {
      trades.forEach((trade: any) => {
        rows.push([
          'trades',
          trade.id ?? '',
          trade.ts ?? trade.created_at ?? '',
          trade.customerId ?? trade.customer_id ?? '',
          trade.amountUSDT ?? trade.quantity ?? '',
          trade.sellPriceQAR ?? trade.unit_price ?? '',
          trade.feeQAR ?? trade.fee ?? '',
          trade.note ?? trade.notes ?? '',
          trade.voided ?? trade.status ?? '',
          JSON.stringify({ linkedDealId: trade.linkedDealId ?? null, linkedRelId: trade.linkedRelId ?? null }),
        ].map((cell) => JSON.stringify(cell ?? '')).join(','));
      });
    } else {
      const addRows = (collection: string, items: any[], mapper: (item: any) => string[]) => {
        items.forEach((item) => {
          rows.push([collection, ...mapper(item)].map((cell) => JSON.stringify(cell ?? '')).join(','));
        });
      };

      addRows('batches', batches, (b) => [
        b.id ?? '',
        b.ts ?? b.acquired_at ?? b.created_at ?? '',
        b.source ?? b.supplier ?? '',
        b.buyPriceQAR ?? b.priceQAR ?? b.price ?? b.unit_cost ?? '',
        b.initialUSDT ?? b.qty ?? b.quantity ?? '',
        b.note ?? b.notes ?? '',
        JSON.stringify({ custodyType: b.custodyType ?? null, custodyMerchantId: b.custodyMerchantId ?? null }),
      ]);
      addRows('customers', customers, (c) => [
        c.id ?? '',
        c.createdAt ?? c.created_at ?? '',
        c.name ?? '',
        c.phone ?? '',
        c.tier ?? '',
        c.dailyLimitUSDT ?? '',
        c.notes ?? '',
        JSON.stringify(c),
      ]);
      addRows('suppliers', suppliers, (s) => [
        s.id ?? '',
        s.createdAt ?? s.created_at ?? '',
        s.name ?? '',
        s.phone ?? '',
        s.notes ?? '',
        JSON.stringify(s),
      ]);
      addRows('cashAccounts', cashAccounts, (a) => [
        a.id ?? '',
        a.createdAt ?? a.created_at ?? '',
        a.name ?? '',
        a.type ?? '',
        a.currency ?? '',
        a.status ?? '',
        a.nickname ?? '',
        JSON.stringify({ merchantId: a.merchantId ?? null, relationshipId: a.relationshipId ?? null, purpose: a.purpose ?? null }),
      ]);
      addRows('cashLedger', cashLedger, (l) => [
        l.id ?? '',
        l.ts ?? '',
        l.type ?? '',
        l.accountId ?? '',
        l.direction ?? '',
        l.amount ?? '',
        l.currency ?? '',
        l.note ?? '',
        JSON.stringify({ merchantId: l.merchantId ?? null, tradeId: l.tradeId ?? null, orderId: l.orderId ?? null, batchId: l.batchId ?? null }),
      ]);
      addRows('cashHistory', cashHistory, (h) => [
        h.id ?? '',
        h.ts ?? '',
        h.type ?? '',
        h.amount ?? '',
        h.balanceAfter ?? '',
        h.owner ?? '',
        h.bankAccount ?? '',
        h.note ?? '',
        JSON.stringify(h),
      ]);
    }

    downloadBlob([headers.join(','), ...rows].join('\n'), `p2p-tracker-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv');
    setExportStatus('success');
    toast.success(t.lang === 'ar' ? 'تم تصدير CSV' : 'CSV exported');
    setTimeout(() => setExportStatus('idle'), 3000);
  };

  const exportExcel = async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const state = await resolveVaultState() as any;
    const trades = Array.isArray(state.trades) ? state.trades : [];
    const batches = Array.isArray(state.batches) ? state.batches : [];
    const customers = Array.isArray(state.customers) ? state.customers : [];
    const suppliers = Array.isArray(state.suppliers) ? state.suppliers : [];
    const cashAccounts = Array.isArray(state.cashAccounts) ? state.cashAccounts : [];
    const cashLedger = Array.isArray(state.cashLedger) ? state.cashLedger : [];
    const cashHistory = Array.isArray(state.cashHistory) ? state.cashHistory : [];

    const hasData =
      trades.length > 0 ||
      batches.length > 0 ||
      customers.length > 0 ||
      suppliers.length > 0 ||
      cashAccounts.length > 0 ||
      cashLedger.length > 0 ||
      cashHistory.length > 0;

    if (!hasData) {
      toast.error(t.lang === 'ar' ? 'لا توجد بيانات للتصدير' : 'No data to export');
      return;
    }

    if (trades.length || batches.length) {
      const localizedCurrency = baseFiat === 'EGP' ? 'جنيه' : 'ريال';
      const tradeHeaders = ['ID', 'Date', 'Amount USDT', `Sell Price ${localizedCurrency}`, `Fee ${localizedCurrency}`, 'Note', 'Voided'];
      const tradeRows = trades.map((tr: any) => [
        tr.id || '', new Date(tr.ts || tr.created_at || 0).toLocaleString(),
        tr.amountUSDT ?? tr.quantity ?? '', tr.sellPriceQAR ?? tr.unit_price ?? '',
        tr.feeQAR ?? tr.fee ?? '', tr.note ?? tr.notes ?? '', tr.voided ?? tr.status ?? ''
      ].join('\t'));
      const batchHeaders = ['ID', 'Date', 'Quantity USDT', `Buy Price ${localizedCurrency}`, 'Source', 'Note'];
      const batchRows = batches.map((b: any) => [
        b.id || '', new Date(b.ts || b.acquired_at || b.created_at || 0).toLocaleString(),
        b.initialUSDT ?? b.qty ?? b.quantity ?? '', b.buyPriceQAR ?? b.priceQAR ?? b.price ?? b.unit_cost ?? '',
        b.source ?? b.supplier ?? b.notes ?? '', b.note ?? ''
      ].join('\t'));
      const content = `TRADES\n${tradeHeaders.join('\t')}\n${tradeRows.join('\n')}\n\nBATCHES\n${batchHeaders.join('\t')}\n${batchRows.join('\n')}`;
      downloadBlob(content, `p2p-tracker-${new Date().toISOString().slice(0, 10)}.tsv`, 'text/tab-separated-values');
    } else {
      const headers = ['collection', 'id', 'ts', 'label', 'amount_or_qty', 'rate_or_type', 'fee_or_direction', 'note', 'status', 'payload'];
      const rows: string[] = [];
      const addRows = (collection: string, items: any[], mapper: (item: any) => string[]) => {
        items.forEach((item) => {
          rows.push([collection, ...mapper(item)].map((cell) => String(cell ?? '').replace(/\t/g, ' ')).join('\t'));
        });
      };

      addRows('customers', customers, (c) => [
        c.id ?? '',
        c.createdAt ?? c.created_at ?? '',
        c.name ?? '',
        c.phone ?? '',
        c.tier ?? '',
        c.dailyLimitUSDT ?? '',
        c.notes ?? '',
        JSON.stringify(c),
      ]);
      addRows('suppliers', suppliers, (s) => [
        s.id ?? '',
        s.createdAt ?? s.created_at ?? '',
        s.name ?? '',
        s.phone ?? '',
        s.notes ?? '',
        JSON.stringify(s),
      ]);
      addRows('cashAccounts', cashAccounts, (a) => [
        a.id ?? '',
        a.createdAt ?? a.created_at ?? '',
        a.name ?? '',
        a.type ?? '',
        a.currency ?? '',
        a.status ?? '',
        a.nickname ?? '',
        JSON.stringify({ merchantId: a.merchantId ?? null, relationshipId: a.relationshipId ?? null, purpose: a.purpose ?? null }),
      ]);
      addRows('cashLedger', cashLedger, (l) => [
        l.id ?? '',
        l.ts ?? '',
        l.type ?? '',
        l.accountId ?? '',
        l.direction ?? '',
        l.amount ?? '',
        l.currency ?? '',
        l.note ?? '',
        JSON.stringify({ merchantId: l.merchantId ?? null, tradeId: l.tradeId ?? null, orderId: l.orderId ?? null, batchId: l.batchId ?? null }),
      ]);
      addRows('cashHistory', cashHistory, (h) => [
        h.id ?? '',
        h.ts ?? '',
        h.type ?? '',
        h.amount ?? '',
        h.balanceAfter ?? '',
        h.owner ?? '',
        h.bankAccount ?? '',
        h.note ?? '',
        JSON.stringify(h),
      ]);

      const content = [headers.join('\t'), ...rows].join('\n');
      downloadBlob(content, `p2p-tracker-${new Date().toISOString().slice(0, 10)}.tsv`, 'text/tab-separated-values');
    }
    setExportStatus('success');
    toast.success(t.lang === 'ar' ? 'تم تصدير Excel (TSV)' : 'Excel (TSV) exported');
    setTimeout(() => setExportStatus('idle'), 3000);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setImportStatus('loading');
    setImportMsg('');
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string);
        const normalized = normalizeImportedTrackerState(data);
        const itemCount = countVaultItems(normalized);
        
        if (!confirm(
          t.lang === 'ar' 
            ? `استيراد هذه البيانات؟ (${itemCount} سجل)\nسيتم استبدال البيانات الحالية.`
            : `Import this data? (${itemCount} records)\nThis will replace your current state.`
        )) {
          setImportStatus('idle');
          return;
        }
        const sk = findTrackerStorageKey(localStorage);
        localStorage.removeItem('tracker_data_cleared');
        localStorage.setItem(sk, JSON.stringify(normalized));
        void saveTrackerStateNow(normalized as unknown as TrackerState);
        setImportStatus('success');
        setImportMsg(t.lang === 'ar' 
          ? `✓ تم الاستيراد: ${itemCount} سجل`
          : `✓ Imported: ${itemCount} records`);
        toast.success(t.lang === 'ar' ? 'تم استيراد البيانات — جاري إعادة التحميل…' : `Data imported (${itemCount} records) — reloading…`);
        setTimeout(() => window.location.reload(), 1000);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (err: any) {
        setImportStatus('error');
        setImportMsg(t.lang === 'ar' ? 'ملف JSON غير صالح أو تنسيق غير مدعوم' : 'Invalid JSON file or unsupported format');
        toast.error(t.lang === 'ar' ? 'ملف JSON غير صالح' : 'Invalid JSON file');
      }
    };
    reader.onerror = () => {
      setImportStatus('error');
      setImportMsg(t.lang === 'ar' ? 'فشل قراءة الملف' : 'Failed to read file');
    };
    reader.readAsText(f);
    e.target.value = '';
  };

  const clearAll = async () => {
    if (!confirm(t.lang === 'ar' ? '⚠ مسح جميع البيانات؟ لا يمكن التراجع إلا إذا كان لديك نسخة احتياطية.' : '⚠ Clear ALL data? This cannot be undone unless you have a backup.')) return;
    clearTrackerStorage(localStorage);
    localStorage.setItem('tracker_data_cleared', 'true');
    await clearTrackerVaultDb();
    const emptyState = { batches: [], trades: [], customers: [], suppliers: [], cashQAR: 0, cashOwner: '', cashHistory: [], cashAccounts: [], cashLedger: [], currency: 'QAR', range: '7d', settings: { lowStockThreshold: 5000, priceAlertThreshold: 2 }, cal: { year: new Date().getFullYear(), month: new Date().getMonth(), selectedDay: null } };
    void saveTrackerStateNow(emptyState as unknown as TrackerState);
    toast.success(t.lang === 'ar' ? 'تم مسح البيانات — جاري إعادة التحميل…' : 'Data cleared — reloading…');
    setTimeout(() => window.location.reload(), 500);
  };

  const fmtDate = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString();
  };

  return (
    <div className="tracker-page" dir={t.isRTL ? 'rtl' : 'ltr'}>
      <PageHeader 
        title={t('vaultTitle')} 
        description={t('vaultSub')} 
      />

      <div className="p-6 space-y-4">
        {/* ── Unified Backup & Recovery ── */}
        <Card className="glass">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-display">
                {t.lang === 'ar' ? '🔒 النسخ الاحتياطي والاسترداد' : '🔒 Backup & Recovery'}
              </CardTitle>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[10px]">{snaps.length} {t.lang === 'ar' ? 'محلي' : 'local'} · {cloudBackups.length} {t.lang === 'ar' ? 'سحابي' : 'cloud'}</Badge>
                {userId ? (
                  <Badge variant="outline" className="text-[10px] text-green-500 border-green-500/30">✓ {t.lang === 'ar' ? 'متصل' : 'Connected'}</Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px] text-yellow-500 border-yellow-500/30">⚠ {t.lang === 'ar' ? 'غير متصل' : 'Offline'}</Badge>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <p className="text-[11px] text-muted-foreground">{t.lang === 'ar' ? `نسخ تلقائي كل 30 دقيقة + نسخ محلية. ${email || ''}` : `Auto-backup every 30 min + local snapshots. ${email || ''}`}</p>

            {/* Quick Actions */}
            <div className="flex gap-2 flex-wrap">
              <Input value={cloudLabel} onChange={e => setCloudLabel(e.target.value)} placeholder={t.lang === 'ar' ? 'وصف (اختياري)' : 'Label (optional)'} className="flex-1 min-w-[120px] text-[11px]" />
              <Button size="sm" onClick={cloudBackupNow} disabled={cloudLoading || !userId} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                {cloudLoading ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Cloud className="w-3 h-3 mr-1" />}
                {t.lang === 'ar' ? '☁ سحابي' : '☁ Cloud'}
              </Button>
              <Input value={snapDesc} onChange={e => setSnapDesc(e.target.value)} placeholder={t.lang === 'ar' ? 'وصف محلي' : 'Local label'} className="w-32 text-[11px]" />
              <Button size="sm" variant="outline" onClick={takeSnapshot} disabled={loading}>
                <Camera className="w-3 h-3 mr-1" /> {t.lang === 'ar' ? '💾 محلي' : '💾 Local'}
              </Button>
            </div>

            <div className="flex items-center justify-between px-1">
              <Label className="text-xs">{t.lang === 'ar' ? 'نسخ تلقائي (كل 30 دقيقة)' : 'Auto-backup (every 30 min)'}</Label>
              <Switch checked={autoBackup} onCheckedChange={handleAutoBackupToggle} />
            </div>

            {/* Cloud Backups */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">☁ {t.lang === 'ar' ? 'سحابي' : 'Cloud'} ({cloudBackups.length})</h3>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" className="h-6 text-[9px] px-2" onClick={loadCloudBackups} disabled={cloudLoading}><RefreshCw className={`w-3 h-3 ${cloudLoading ? 'animate-spin' : ''}`} /></Button>
                  <label className="cursor-pointer"><Button variant="ghost" size="sm" className="h-6 text-[9px] px-2" asChild><span><Upload className="w-3 h-3" /></span></Button><input ref={cloudImportRef} type="file" accept=".json" className="hidden" onChange={handleCloudImportFile} /></label>
                </div>
              </div>
              <div className="max-h-[240px] overflow-y-auto space-y-1">
                {cloudBackups.length === 0 ? (
                  <p className="text-[10px] text-muted-foreground text-center py-3">{t.lang === 'ar' ? 'لا توجد نسخ سحابية بعد' : 'No cloud backups yet'}</p>
                ) : cloudBackups.map((b, idx) => {
                  const vn = cloudBackups.length - idx;
                  const dt = b.createdAt ? new Date(b.createdAt).toLocaleString() : '—';
                  const sz = b.sizeBytes > 0 ? sbFmtBytes(b.sizeBytes) : '';
                  return (
                    <div key={b.id} className="flex justify-between items-center gap-2 p-2 rounded-lg border border-border/50 bg-card/50">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5"><span className="font-bold text-[11px]">V{vn}</span>{idx === 0 && <Badge variant="outline" className="text-[8px] text-green-500 border-green-500/30">{t.lang === 'ar' ? 'الأحدث' : 'LATEST'}</Badge>}</div>
                        <div className="text-[9px] text-muted-foreground">{dt}{sz ? ` · ${sz}` : ''}{b.label ? ` · ${b.label}` : ''}</div>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <Button variant="outline" size="sm" className="h-5 text-[8px] px-1.5" onClick={() => restoreCloudBackup(b.name)}>{t.lang === 'ar' ? 'استعادة' : 'Restore'}</Button>
                        <Button variant="outline" size="sm" className="h-5 text-[8px] px-1.5" onClick={() => extractCloudBackup(b.name)}>{t.lang === 'ar' ? 'تصدير' : 'Extract'}</Button>
                        <Button variant="outline" size="sm" className="h-5 text-[8px] px-1.5" onClick={() => previewCloudBackup(b.name, `V${vn}`)}>{t.lang === 'ar' ? 'معاينة' : 'Preview'}</Button>
                        <Button variant="ghost" size="sm" className="h-5 text-[8px] px-1.5 text-destructive" onClick={() => deleteCloudBackup(b.name)}>{t.lang === 'ar' ? 'حذف' : 'Del'}</Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {previewData && (
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
                <div className="flex items-center justify-between"><span className="text-xs font-bold">{previewData.label}</span><Button variant="ghost" size="sm" className="h-5 text-[9px] px-1" onClick={() => setPreviewData(null)}>✕</Button></div>
                <pre className="text-[10px] text-muted-foreground whitespace-pre-wrap font-mono bg-muted/30 rounded p-2">{previewData.summary}</pre>
              </div>
            )}

            {/* Local Snapshots */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">💾 {t.lang === 'ar' ? 'محلي' : 'Local'} ({snaps.length})</h3>
                <Button variant="ghost" size="sm" className="h-6 text-[9px] px-2" onClick={loadSnaps}><RefreshCw className="w-3 h-3" /></Button>
              </div>
              <div className="max-h-[200px] overflow-y-auto space-y-1">
                {snaps.length === 0 ? (
                  <p className="text-[10px] text-muted-foreground text-center py-3">{t.lang === 'ar' ? 'لا توجد نسخ محلية' : 'No local snapshots yet'}</p>
                ) : snaps.slice(0, 8).map(s => (
                  <div key={s.id} className="flex justify-between items-center gap-2 p-2 rounded-lg border border-border/50 bg-card/50">
                    <div className="min-w-0">
                      <div className="text-[11px] font-bold">{fmtDate(s.ts)}</div>
                      <div className="text-[9px] text-muted-foreground">{s.label || '—'} · {s.tradeCount} {t.lang === 'ar' ? 'صفقة' : 'trades'} · {s.sizeKB}KB</div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button variant="outline" size="sm" className="h-5 text-[8px] px-1.5" onClick={() => restoreSnap(s.id)}>{t.lang === 'ar' ? 'استعادة' : 'Restore'}</Button>
                      <Button variant="outline" size="sm" className="h-5 text-[8px] px-1.5" onClick={() => exportSnap(s.id)}>{t.lang === 'ar' ? 'تصدير' : 'Export'}</Button>
                      <Button variant="ghost" size="sm" className="h-5 text-[8px] px-1.5 text-destructive" onClick={() => deleteSnap(s.id)}>{t.lang === 'ar' ? 'حذف' : 'Del'}</Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="border-t pt-3">
              <Button variant="destructive" size="sm" onClick={clearAll}><AlertTriangle className="w-3 h-3 mr-1" /> {t.lang === 'ar' ? 'مسح جميع البيانات' : 'Clear All Data'}</Button>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-4">
          {/* ── 📦 Data Export & Import ── */}
          <Card className="glass">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-display">
                  {t.lang === 'ar' ? '📦 تصدير واستيراد البيانات' : '📦 Data Export & Import'}
                </CardTitle>
                <Badge variant="outline" className="text-[10px]">JSON · Excel · CSV</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                {t.lang === 'ar' 
                  ? 'صدّر بياناتك للنسخ الاحتياطي، تحليل Excel، أو النقل بين الأجهزة.'
                  : 'Export your data for offline backup, Excel analysis, or transfer between devices.'}
              </p>

              <div className="flex gap-2 flex-wrap">
                <Button variant="outline" size="sm" onClick={exportExcel}>
                  <FileSpreadsheet className="w-3 h-3 mr-1" /> Excel
                </Button>
                <Button variant="outline" size="sm" onClick={exportJSON}>
                  <FileJson className="w-3 h-3 mr-1" /> JSON
                </Button>
                <Button variant="outline" size="sm" onClick={exportCSV}>
                  <FileText className="w-3 h-3 mr-1" /> CSV
                </Button>
                {exportStatus === 'success' && (
                  <span className="flex items-center gap-1 text-[10px] text-green-500">
                    <CheckCircle2 className="w-3 h-3" /> {t.lang === 'ar' ? 'تم التصدير' : 'Exported'}
                  </span>
                )}
              </div>

              <div className="space-y-2">
                <label className="block">
                  <Button variant="outline" size="sm" className="cursor-pointer" asChild>
                    <span><Upload className="w-3 h-3 mr-1" /> {t.lang === 'ar' ? 'استيراد JSON' : 'Import JSON'}</span>
                  </Button>
                  <input ref={importInputRef} type="file" accept="application/json,.json" className="hidden" onChange={handleImport} />
                </label>
                {importStatus === 'loading' && (
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    <Loader2 className="w-3 h-3 animate-spin" /> {t.lang === 'ar' ? 'جاري المعالجة...' : 'Processing...'}
                  </div>
                )}
                {importStatus === 'success' && (
                  <div className="flex items-center gap-2 text-[10px] text-green-500">
                    <CheckCircle2 className="w-3 h-3" /> {importMsg}
                  </div>
                )}
                {importStatus === 'error' && (
                  <div className="flex items-center gap-2 text-[10px] text-destructive">
                    <XCircle className="w-3 h-3" /> {importMsg}
                  </div>
                )}
              </div>

              <div className="border-t pt-3 space-y-2">
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground opacity-70">
                  {t.lang === 'ar' ? 'أدوات متقدمة' : 'Advanced Tools'}
                </Label>
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" onClick={() => navigate('/trading/orders/import-ledger')}>
                     <RefreshCw className="w-3 h-3 mr-1" /> {t('importLedger')}
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  {t.lang === 'ar' 
                    ? 'استيراد سجلات PDF أو نصية من الوسطاء تلقائياً.' 
                    : 'Bulk-import merchant ledgers from pasted text or screenshots.'}
                </p>
              </div>

              <div className="border-t pt-3">
                <Button variant="destructive" size="sm" onClick={clearAll}>
                  <AlertTriangle className="w-3 h-3 mr-1" /> {t.lang === 'ar' ? 'مسح جميع البيانات' : 'Clear All Data'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
