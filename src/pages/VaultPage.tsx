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
import { Camera, Download, Upload, Trash2, RefreshCw, Eye, FileJson, FileSpreadsheet, FileText, AlertTriangle, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { useT } from '@/lib/i18n';
import {
  clearTrackerStorage,
  findTrackerStorageKey,
  getCurrentTrackerState,
  loadAutoBackupFromStorage,
  normalizeImportedTrackerState,
  saveAutoBackupToStorage,
} from '@/lib/tracker-backup';
import { saveTrackerStateNow } from '@/lib/tracker-sync';
import type { TrackerState } from '@/lib/tracker-helpers';

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
    tradeCount: Array.isArray((state as any)?.trades) ? (state as any).trades.length : 0,
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

  const [snaps, setSnaps] = useState<Snapshot[]>([]);
  const [snapDesc, setSnapDesc] = useState('');
  const [loading, setLoading] = useState(false);
  const [autoBackup, setAutoBackup] = useState(() => loadAutoBackupFromStorage(localStorage));
  const importInputRef = useRef<HTMLInputElement>(null);
  const [importStatus, setImportStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [importMsg, setImportMsg] = useState('');
  const [exportStatus, setExportStatus] = useState<'idle' | 'success'>('idle');

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
      const state = getCurrentState();
      await idbSave(state, snapDesc.trim());
      setSnapDesc('');
      toast.success(t.lang === 'ar' ? '📸 تم حفظ النسخة' : '📸 Snapshot saved');
      await loadSnaps();
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

  // Data export helpers
  const exportJSON = () => {
    const state = getCurrentState();
    const fname = `p2p-tracker-${new Date().toISOString().slice(0, 10)}.json`;
    downloadBlob(JSON.stringify(state, null, 2), fname);
    setExportStatus('success');
    toast.success(t.lang === 'ar' ? 'تم تصدير JSON' : 'JSON exported');
    setTimeout(() => setExportStatus('idle'), 3000);
  };

  const exportCSV = () => {
    const state = getCurrentState() as any;
    const trades = state.trades || [];
    if (!trades.length) { toast.error(t.lang === 'ar' ? 'لا توجد صفقات للتصدير' : 'No trades to export'); return; }
    const headers = ['id', 'ts', 'amountUSDT', 'sellPriceQAR', 'feeQAR', 'note', 'voided'];
    const rows = trades.map((t: any) => headers.map(h => JSON.stringify(t[h] ?? '')).join(','));
    downloadBlob([headers.join(','), ...rows].join('\n'), `trades-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv');
    setExportStatus('success');
    toast.success(t.lang === 'ar' ? 'تم تصدير CSV' : 'CSV exported');
    setTimeout(() => setExportStatus('idle'), 3000);
  };

  const exportExcel = () => {
    const state = getCurrentState() as any;
    const trades = state.trades || [];
    const batches = state.batches || [];
    if (!trades.length && !batches.length) {
      toast.error(t.lang === 'ar' ? 'لا توجد بيانات للتصدير' : 'No data to export');
      return;
    }
    const tradeHeaders = ['ID', 'Date', 'Amount USDT', 'Sell Price QAR', 'Fee QAR', 'Note', 'Voided'];
    const tradeRows = trades.map((tr: any) => [
      tr.id || '', new Date(tr.ts || tr.created_at || 0).toLocaleString(),
      tr.amountUSDT ?? tr.quantity ?? '', tr.sellPriceQAR ?? tr.unit_price ?? '',
      tr.feeQAR ?? tr.fee ?? '', tr.note ?? tr.notes ?? '', tr.voided ?? tr.status ?? ''
    ].join('\t'));
    const batchHeaders = ['ID', 'Date', 'Quantity', 'Price', 'Source', 'Note'];
    const batchRows = batches.map((b: any) => [
      b.id || '', new Date(b.ts || b.acquired_at || b.created_at || 0).toLocaleString(),
      b.qty ?? b.quantity ?? '', b.priceQAR ?? b.unit_cost ?? '',
      b.source ?? b.notes ?? '', b.note ?? ''
    ].join('\t'));
    const content = `TRADES\n${tradeHeaders.join('\t')}\n${tradeRows.join('\n')}\n\nBATCHES\n${batchHeaders.join('\t')}\n${batchRows.join('\n')}`;
    downloadBlob(content, `p2p-tracker-${new Date().toISOString().slice(0, 10)}.tsv`, 'text/tab-separated-values');
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
        const tradeCount = Array.isArray(normalized.trades) ? (normalized.trades as any[]).length : 0;
        const batchCount = Array.isArray(normalized.batches) ? (normalized.batches as any[]).length : 0;
        
        if (!confirm(
          t.lang === 'ar' 
            ? `استيراد هذه البيانات؟ (${tradeCount} صفقة، ${batchCount} دفعة)\nسيتم استبدال البيانات الحالية.`
            : `Import this data? (${tradeCount} trades, ${batchCount} batches)\nThis will replace your current state.`
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
          ? `✓ تم الاستيراد: ${tradeCount} صفقة، ${batchCount} دفعة` 
          : `✓ Imported: ${tradeCount} trades, ${batchCount} batches`);
        toast.success(t.lang === 'ar' ? 'تم استيراد البيانات — جاري إعادة التحميل…' : 'Data imported — reloading…');
        setTimeout(() => window.location.reload(), 1000);
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
    const emptyState = { batches: [], trades: [], customers: [], cashQAR: 0, cashOwner: '', currency: 'QAR', range: '7d', settings: { lowStockThreshold: 5000, priceAlertThreshold: 2 }, cal: { year: new Date().getFullYear(), month: new Date().getMonth(), selectedDay: null } };
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
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* ── Ring 1: Local IndexedDB ── */}
          <Card className="glass">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-display">
                  {t.lang === 'ar' ? '💾 الحلقة 1 — نسخ محلية' : '💾 Ring 1 — Local Snapshots'}
                </CardTitle>
                <Badge variant="outline" className="text-[10px]">IndexedDB</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                {t.lang === 'ar' 
                  ? 'نسخ احتياطية محلية تلقائية كل 10 عمليات حفظ. تبقى حتى بعد مسح ذاكرة المتصفح.'
                  : 'Automatic local snapshots every 10 saves. Survives browser cache clears. No internet required.'}
              </p>

              <div className="space-y-2">
                <Label className="text-xs">{t.lang === 'ar' ? 'الوصف *' : 'Description *'}</Label>
                <Input
                  value={snapDesc}
                  onChange={e => setSnapDesc(e.target.value)}
                  placeholder={t.lang === 'ar' ? 'لماذا تأخذ هذه النسخة؟' : 'Why are you taking this snapshot?'}
                />
              </div>

              <Button onClick={takeSnapshot} disabled={loading} size="sm">
                <Camera className="w-3 h-3 mr-1" /> {t.lang === 'ar' ? 'أخذ نسخة الآن' : 'Take Snapshot Now'}
              </Button>

              {/* Snapshot list */}
              <div className="space-y-0 border-t pt-3">
                {snaps.length === 0 ? (
                  <p className="text-[10px] text-muted-foreground">
                    {t.lang === 'ar' ? 'لا توجد نسخ محلية بعد.' : 'No local snapshots yet. They are created every 10 saves automatically.'}
                  </p>
                ) : (
                  snaps.slice(0, 8).map(s => (
                    <div key={s.id} className="flex justify-between items-start gap-2 py-2 border-b border-border/50">
                      <div className="min-w-0">
                        <div className="flex gap-2 items-baseline">
                          <span className="text-[11px] font-bold whitespace-nowrap">{fmtDate(s.ts)}</span>
                          <span className="text-[10px] text-muted-foreground truncate">{s.label || '—'}</span>
                        </div>
                        <div className="text-[9px] text-muted-foreground">
                          {s.tradeCount} {t.lang === 'ar' ? 'صفقة' : 'trades'} · {s.batchCount} {t.lang === 'ar' ? 'دفعة' : 'batches'} · {s.sizeKB} KB · ✓ {(s.checksum || '—').slice(0, 8)}
                        </div>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <Button variant="ghost" size="sm" className="h-6 text-[9px] px-2" onClick={() => restoreSnap(s.id)}>
                          {t.lang === 'ar' ? 'استعادة' : 'Restore'}
                        </Button>
                        <Button variant="ghost" size="sm" className="h-6 text-[9px] px-2" onClick={() => exportSnap(s.id)}>
                          {t.lang === 'ar' ? 'تصدير' : 'Export'}
                        </Button>
                        <Button variant="ghost" size="sm" className="h-6 text-[9px] px-2 text-destructive" onClick={() => deleteSnap(s.id)}>
                          {t.lang === 'ar' ? 'حذف' : 'Del'}
                        </Button>
                      </div>
                    </div>
                  ))
                )}
                {snaps.length > 8 && (
                  <p className="text-[10px] text-muted-foreground pt-2">+{snaps.length - 8} {t.lang === 'ar' ? 'نسخ أقدم' : 'more older snapshots'}</p>
                )}
              </div>

              {/* Recovery */}
              <div className="border-t pt-3">
                <Label className="text-xs mb-2 block">{t.lang === 'ar' ? 'وضع الاسترداد' : 'Recovery Mode'}</Label>
                <p className="text-[10px] text-muted-foreground">
                  {snaps.length} {t.lang === 'ar' ? 'نسخة' : 'snapshots'}{snaps.length > 0 ? ` · ${t.lang === 'ar' ? 'الأحدث' : 'Latest'}: ${new Date(snaps[0].ts).toLocaleTimeString()}` : ''}
                </p>
                <Button variant="outline" size="sm" className="mt-2 text-[10px]" onClick={loadSnaps}>
                  <RefreshCw className="w-3 h-3 mr-1" /> {t.lang === 'ar' ? 'تحديث' : 'Refresh'}
                </Button>
              </div>

              {/* Auto-backup toggle */}
              <div className="flex items-center justify-between pt-2 border-t">
                <Label className="text-xs">{t.lang === 'ar' ? 'نسخ تلقائي بعد كل تغيير' : 'Auto-backup after every change'}</Label>
                <Switch checked={autoBackup} onCheckedChange={handleAutoBackupToggle} />
              </div>
            </CardContent>
          </Card>

          {/* ── Data Export & Import ── */}
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