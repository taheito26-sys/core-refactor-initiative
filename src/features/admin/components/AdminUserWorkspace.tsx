import { useState, useCallback } from 'react';
import { format } from 'date-fns';
import { ArrowLeft, Edit, Ban, Loader2, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { AdminOrdersMirror } from './AdminOrdersMirror';
import { AdminStockMirror } from './AdminStockMirror';
import DashboardPage from '@/pages/DashboardPage';
import MerchantsPage from '@/pages/MerchantsPage';
import CRMPage from '@/pages/CRMPage';
import { fmtTotal } from '@/lib/tracker-helpers';
import {
  useAdminWorkspace,
  useAdminCorrectDeal,
  useAdminVoidDeal,
  useAdminCorrectTracker,
  useAdminVoidTrackerEntity,
} from '../hooks/useAdminWorkspace';

interface Props {
  userId: string;
  onBack: () => void;
}

export function AdminUserWorkspace({ userId, onBack }: Props) {
  const { toast } = useToast();
  const { data: workspace, isLoading: workspaceLoading } = useAdminWorkspace(userId);
  const correctDeal = useAdminCorrectDeal();
  const voidDeal = useAdminVoidDeal();
  const correctTracker = useAdminCorrectTracker();
  const voidTrackerEntity = useAdminVoidTrackerEntity();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [editDeal, setEditDeal] = useState<any | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [editReason, setEditReason] = useState('');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [voidTarget, setVoidTarget] = useState<any | null>(null);
  const [voidReason, setVoidReason] = useState('');

  // Tracker edit state
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [editEntity, setEditEntity] = useState<{ type: 'batch' | 'trade'; data: any } | null>(null);
  const [editEntityQty, setEditEntityQty] = useState('');
  const [editEntityPrice, setEditEntityPrice] = useState('');
  const [editEntityReason, setEditEntityReason] = useState('');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [voidEntity, setVoidEntity] = useState<{ type: 'batch' | 'trade'; data: any } | null>(null);
  const [voidEntityReason, setVoidEntityReason] = useState('');

  const workspaceProfiles = Array.isArray(workspace?.merchant_profiles) ? workspace.merchant_profiles : [];
  const profileFallback =
    workspaceProfiles.find((p: any) => p?.user_id === userId) ??
    null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const profile = (workspace?.merchant_profile ?? profileFallback) as any;
  const trackerSnapshot = workspace?.tracker_snapshot ?? null;
  const trackerState = trackerSnapshot?.state as any;
  const trackerPreferences = trackerSnapshot?.preferences as any;
  const batches = Array.isArray(trackerState?.batches) ? trackerState.batches : [];
  const trades = Array.isArray(trackerState?.trades) ? trackerState.trades : [];
  const userBaseFiat = trackerState?.settings?.baseFiatCurrency || trackerPreferences?.baseFiatCurrency || 'QAR';
  const deals = (workspace?.deals ?? []) as any[];
  const settlements = (workspace?.settlements ?? []) as any[];
  const profits = (workspace?.profits ?? []) as any[];
  const profileLoading = workspaceLoading;
  const dealsLoading = workspaceLoading;
  const tracker = trackerSnapshot;

  const resolvedMerchantId =
    profile?.merchant_id ??
    workspaceProfiles.find((p: any) => p?.user_id === userId)?.merchant_id ??
    null;

  const hasAnyWorkspaceData =
    !!profile ||
    !!trackerSnapshot ||
    deals.length > 0 ||
    settlements.length > 0 ||
    profits.length > 0 ||
    workspaceProfiles.length > 0;

  const exportCSV = useCallback((filename: string, headers: string[], rows: string[][]) => {
    const csv = [headers.join(','), ...rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
    toast({ title: 'Exported', description: `${filename} downloaded.` });
  }, [toast]);

  const exportDeals = () => {
    if (!deals?.length) return;
    exportCSV(`deals_${userId.slice(0,8)}.csv`,
      ['ID','Title','Amount','Currency','Type','Status','Created','Notes'],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      deals.map((d: any) => [d.id, d.title, d.amount, d.currency, d.deal_type, d.status, d.created_at, d.notes ?? ''])
    );
  };

  const exportSettlements = () => {
    if (!settlements?.length) return;
    exportCSV(`settlements_${userId.slice(0,8)}.csv`,
      ['ID','Deal ID','Amount','Currency','Date','Notes'],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      settlements.map((s: any) => [s.id, s.deal_id, s.amount, s.currency, s.created_at, s.notes ?? ''])
    );
  };

  const exportTrades = () => {
    if (!trades.length) return;
    exportCSV(`trades_${userId.slice(0,8)}.csv`,
      ['ID','Amount USDT',`Sell Price ${userBaseFiat}`,'Customer','Date','Voided'],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      trades.map((t: any) => [t.id, t.amountUSDT ?? t.qty ?? '', t.sellPriceQAR ?? t.price ?? '', t.customer ?? '', t.ts ? new Date(t.ts).toISOString() : '', t.voided ? 'yes' : 'no'])
    );
  };

  const exportBatches = () => {
    if (!batches.length) return;
    exportCSV(`batches_${userId.slice(0,8)}.csv`,
      ['ID','Qty USDT',`Buy Price ${userBaseFiat}`,'Supplier','Date','Voided'],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      batches.map((b: any) => [b.id, b.initialUSDT ?? b.qty ?? '', b.buyPriceQAR ?? b.price ?? '', b.source ?? b.supplier ?? '', b.ts ? new Date(b.ts).toISOString() : '', b.voided ? 'yes' : 'no'])
    );
  };

  const exportAll = () => {
    exportDeals();
    exportSettlements();
    exportTrades();
    exportBatches();
  };

  if (workspaceLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24" />
      </div>
    );
  }

  if (!hasAnyWorkspaceData) {
    return (
      <div className="space-y-4">
        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground">
            No admin-readable workspace data found for this user.
          </CardContent>
        </Card>
      </div>
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const openEdit = (deal: any) => {
    setEditDeal(deal);
    setEditTitle(deal.title);
    setEditAmount(String(deal.amount));
    setEditReason('');
  };

  const handleCorrect = async () => {
    if (!editDeal || !editReason.trim()) return;
    try {
      await correctDeal.mutateAsync({
        dealId: editDeal.id,
        updates: { title: editTitle, amount: Number(editAmount) },
        reason: editReason.trim(),
      });
      toast({ title: 'Deal corrected', description: 'Audit log recorded.' });
      setEditDeal(null);
    } catch {
      toast({ title: 'Error', description: 'Failed to correct deal.', variant: 'destructive' });
    }
  };

  const handleVoid = async () => {
    if (!voidTarget || !voidReason.trim()) return;
    try {
      await voidDeal.mutateAsync({ dealId: voidTarget.id, reason: voidReason.trim() });
      toast({ title: 'Deal voided', description: 'Audit log recorded.' });
      setVoidTarget(null);
    } catch {
      toast({ title: 'Error', description: 'Failed to void deal.', variant: 'destructive' });
    }
  };

  const handleCorrectEntity = async () => {
    if (!editEntity || !editEntityReason.trim()) return;
    try {
      const updates: Record<string, unknown> = {};
      if (editEntity.type === 'batch') {
        if (editEntityQty) updates.initialUSDT = Number(editEntityQty);
        if (editEntityPrice) updates.buyPriceQAR = Number(editEntityPrice);
      } else {
        if (editEntityQty) updates.amountUSDT = Number(editEntityQty);
        if (editEntityPrice) updates.sellPriceQAR = Number(editEntityPrice);
      }
      await correctTracker.mutateAsync({
        targetUserId: userId, entityType: editEntity.type, entityId: editEntity.data.id,
        updates, reason: editEntityReason.trim(),
      });
      toast({ title: `${editEntity.type} corrected`, description: 'Audit log recorded.' });
      setEditEntity(null);
    } catch {
      toast({ title: 'Error', description: 'Failed to correct record.', variant: 'destructive' });
    }
  };

  const handleVoidEntity = async () => {
    if (!voidEntity || !voidEntityReason.trim()) return;
    try {
      await voidTrackerEntity.mutateAsync({
        targetUserId: userId, entityType: voidEntity.type, entityId: voidEntity.data.id,
        reason: voidEntityReason.trim(),
      });
      toast({ title: `${voidEntity.type} voided`, description: 'Audit log recorded.' });
      setVoidEntity(null);
    } catch {
      toast({ title: 'Error', description: 'Failed to void record.', variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4 mr-1" /> Back</Button>
        <h2 className="text-lg font-semibold text-foreground flex-1">
          User Workspace â€” {profile?.display_name || userId.slice(0, 8)}
        </h2>
        <Button variant="outline" size="sm" className="text-xs gap-1" onClick={exportAll}>
          <Download className="h-3 w-3" /> Export All CSV
        </Button>
      </div>

      {/* Profile card */}
      {profileLoading ? <Skeleton className="h-24" /> : (
        <Card>
          <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 text-xs">
            <div><span className="text-muted-foreground">Display Name</span><p className="font-medium">{profile?.display_name ?? '—'}</p></div>
            <div><span className="text-muted-foreground">Merchant ID</span><p className="font-mono">{resolvedMerchantId ?? '—'}</p></div>
            <div><span className="text-muted-foreground">Region</span><p>{profile?.region ?? '—'}</p></div>
            <div><span className="text-muted-foreground">Status</span><p>{profile?.status ? <Badge variant="outline" className="text-[10px]">{profile.status}</Badge> : '—'}</p></div>
          </CardContent>
        </Card>
      )}

      {!profile && (
        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground">
            No merchant profile was returned for this user. Rendering the workspace from the remaining target data only.
          </CardContent>
        </Card>
      )}

      {!trackerSnapshot && (
        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground">
            No tracker snapshot was returned for this user. Tracker-based tabs may be empty.
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="dashboard" className="w-full">
        <TabsList className="w-full justify-start flex-wrap h-auto gap-1">
          <TabsTrigger value="dashboard" className="text-xs">Dashboard</TabsTrigger>
          <TabsTrigger value="merchants" className="text-xs">Merchants</TabsTrigger>
          <TabsTrigger value="orders" className="text-xs">Orders</TabsTrigger>
          <TabsTrigger value="stock" className="text-xs">Stock</TabsTrigger>
          <TabsTrigger value="crm" className="text-xs">CRM</TabsTrigger>
          <TabsTrigger value="deals" className="text-xs">Deals ({deals?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="settlements" className="text-xs">Settlements ({settlements?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="profits" className="text-xs">Profits ({profits?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="tracker" className="text-xs">Tracker ({batches.length}B / {trades.length}T)</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="mt-3">
          <DashboardPage
            adminUserId={userId}
            adminMerchantId={resolvedMerchantId ?? undefined}
            adminTrackerState={trackerState ?? undefined}
            isAdminView
          />
        </TabsContent>

        <TabsContent value="merchants" className="mt-3">
          <MerchantsPage
            adminUserId={userId}
            adminMerchantId={resolvedMerchantId ?? undefined}
            adminMerchantProfile={profile}
            adminTrackerState={trackerState ?? undefined}
            isAdminView
          />
        </TabsContent>

        <TabsContent value="orders" className="mt-3">
          <AdminOrdersMirror
            userId={userId}
            merchantId={resolvedMerchantId}
            trackerState={trackerState ?? null}
            workspace={workspace}
          />
        </TabsContent>

        <TabsContent value="stock" className="mt-3">
          <AdminStockMirror trackerState={trackerState ?? null} />
        </TabsContent>

        <TabsContent value="crm" className="mt-3">
          <CRMPage
            adminTrackerState={trackerState ?? undefined}
            isAdminView
          />
        </TabsContent>

        <TabsContent value="deals" className="mt-3">
          <div className="flex justify-end mb-2">
            <Button variant="ghost" size="sm" className="text-xs gap-1" onClick={exportDeals} disabled={!deals?.length}>
              <Download className="h-3 w-3" /> CSV
            </Button>
          </div>
          {dealsLoading ? <Skeleton className="h-32" /> : !deals?.length ? (
            <p className="text-sm text-muted-foreground text-center py-6">No deals.</p>
          ) : (
            <div className="border rounded-lg overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Title</TableHead>
                    <TableHead className="text-xs">Amount</TableHead>
                    <TableHead className="text-xs">Type</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                    <TableHead className="text-xs">Created</TableHead>
                    <TableHead className="text-xs text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  {deals.map((d: any) => (
                    <TableRow key={d.id}>
                      <TableCell className="text-xs font-medium">{d.title}</TableCell>
                      <TableCell className="text-xs">{fmtTotal(Number(d.amount))} {d.currency}</TableCell>
                      <TableCell><Badge variant="secondary" className="text-[10px]">{d.deal_type}</Badge></TableCell>
                      <TableCell><Badge variant={d.status === 'voided' ? 'destructive' : 'outline'} className="text-[10px]">{d.status}</Badge></TableCell>
                      <TableCell className="text-xs text-muted-foreground">{format(new Date(d.created_at), 'MMM d, yyyy')}</TableCell>
                      <TableCell className="text-right space-x-1">
                        <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2" onClick={() => openEdit(d)}>
                          <Edit className="h-3 w-3 mr-1" /> Edit
                        </Button>
                        {d.status !== 'voided' && d.status !== 'cancelled' && (
                          <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2 text-destructive" onClick={() => { setVoidTarget(d); setVoidReason(''); }}>
                            <Ban className="h-3 w-3 mr-1" /> Void
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="settlements" className="mt-3">
          <div className="flex justify-end mb-2">
            <Button variant="ghost" size="sm" className="text-xs gap-1" onClick={exportSettlements} disabled={!settlements?.length}>
              <Download className="h-3 w-3" /> CSV
            </Button>
          </div>
          {!settlements?.length ? (
            <p className="text-sm text-muted-foreground text-center py-6">No settlements.</p>
          ) : (
            <div className="border rounded-lg overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Deal ID</TableHead>
                    <TableHead className="text-xs">Amount</TableHead>
                    <TableHead className="text-xs">Currency</TableHead>
                    <TableHead className="text-xs">Date</TableHead>
                    <TableHead className="text-xs">Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {settlements.map((s: any) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
                    <TableRow key={s.id}>
                      <TableCell className="text-xs font-mono">{s.deal_id.slice(0, 8)}</TableCell>
                      <TableCell className="text-xs">{fmtTotal(Number(s.amount))}</TableCell>
                      <TableCell className="text-xs">{s.currency}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{format(new Date(s.created_at), 'MMM d, yyyy')}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{s.notes ?? 'â€”'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        </TabsContent>

        <TabsContent value="profits" className="mt-3">
          {!profits?.length ? (
            <p className="text-sm text-muted-foreground text-center py-6">No profit records.</p>
          ) : (
            <div className="border rounded-lg overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Deal ID</TableHead>
                    <TableHead className="text-xs">Amount</TableHead>
                    <TableHead className="text-xs">Currency</TableHead>
                    <TableHead className="text-xs">Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {profits.map((p: any) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
                    <TableRow key={p.id}>
                      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                      <TableCell className="text-xs font-mono">{p.deal_id.slice(0, 8)}</TableCell>
                      <TableCell className="text-xs">{Number(p.amount).toLocaleString()}</TableCell>
                      <TableCell className="text-xs">{p.currency}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{format(new Date(p.created_at), 'MMM d, yyyy')}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="tracker" className="mt-3">
          {!tracker ? (
            <p className="text-sm text-muted-foreground text-center py-6">No tracker data.</p>
          ) : (
            <div className="space-y-4">
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" className="text-xs gap-1" onClick={exportBatches} disabled={!batches.length}>
                  <Download className="h-3 w-3" /> Batches CSV
                </Button>
                <Button variant="ghost" size="sm" className="text-xs gap-1" onClick={exportTrades} disabled={!trades.length}>
                  <Download className="h-3 w-3" /> Trades CSV
                </Button>
              </div>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Batches ({batches.length})</CardTitle></CardHeader>
                <CardContent className="p-0">
                  {batches.length === 0 ? <p className="text-xs text-muted-foreground p-4">No batches.</p> : (
                    <div className="border-t overflow-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs">ID</TableHead>
                            <TableHead className="text-xs">Qty</TableHead>
                            <TableHead className="text-xs">Buy Price ({userBaseFiat})</TableHead>
                            <TableHead className="text-xs">Date</TableHead>
                            <TableHead className="text-xs">Status</TableHead>
                            <TableHead className="text-xs text-right">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {batches.slice(0, 50).map((b: any) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
                            <TableRow key={b.id} className={b.voided ? 'opacity-40' : ''}>
                              <TableCell className="text-xs font-mono">{String(b.id).slice(0, 8)}</TableCell>
                              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                              <TableCell className="text-xs">{b.initialUSDT ?? b.qty}</TableCell>
                              <TableCell className="text-xs">{b.buyPriceQAR ?? b.price}</TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {b.ts ? format(new Date(b.ts), 'MMM d, yyyy') : 'â€”'}
                              </TableCell>
                              <TableCell className="text-xs">
                                {b.voided ? <Badge variant="destructive" className="text-[10px]">voided</Badge> : <Badge variant="outline" className="text-[10px]">active</Badge>}
                              </TableCell>
                              <TableCell className="text-right space-x-1">
                                <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2" onClick={() => {
                                  setEditEntity({ type: 'batch', data: b });
                                  setEditEntityQty(String(b.initialUSDT ?? b.qty ?? ''));
                                  setEditEntityPrice(String(b.buyPriceQAR ?? b.price ?? ''));
                                  setEditEntityReason('');
                                }}>
                                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                                  <Edit className="h-3 w-3 mr-1" /> Edit
                                </Button>
                                {!b.voided && (
                                  <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2 text-destructive" onClick={() => {
                                    setVoidEntity({ type: 'batch', data: b });
                                    setVoidEntityReason('');
                                  }}>
                                    <Ban className="h-3 w-3 mr-1" /> Void
                                  </Button>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Trades ({trades.length})</CardTitle></CardHeader>
                <CardContent className="p-0">
                  {trades.length === 0 ? <p className="text-xs text-muted-foreground p-4">No trades.</p> : (
                    <div className="border-t overflow-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs">ID</TableHead>
                            <TableHead className="text-xs">Qty</TableHead>
                            <TableHead className="text-xs">Sell Price ({userBaseFiat})</TableHead>
                            <TableHead className="text-xs">Customer</TableHead>
                            <TableHead className="text-xs">Date</TableHead>
                            <TableHead className="text-xs">Status</TableHead>
                            <TableHead className="text-xs text-right">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {trades.slice(0, 50).map((t: any) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
                            <TableRow key={t.id} className={t.voided ? 'opacity-40' : ''}>
                              <TableCell className="text-xs font-mono">{String(t.id).slice(0, 8)}</TableCell>
                              <TableCell className="text-xs">{t.amountUSDT ?? t.qty}</TableCell>
                              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                              <TableCell className="text-xs">{t.sellPriceQAR ?? t.price}</TableCell>
                              <TableCell className="text-xs">{t.customer ?? 'â€”'}</TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {t.ts ? format(new Date(t.ts), 'MMM d, yyyy') : 'â€”'}
                              </TableCell>
                              <TableCell className="text-xs">
                                {t.voided ? <Badge variant="destructive" className="text-[10px]">voided</Badge> : <Badge variant="outline" className="text-[10px]">active</Badge>}
                              </TableCell>
                              <TableCell className="text-right space-x-1">
                                <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2" onClick={() => {
                                  setEditEntity({ type: 'trade', data: t });
                                  setEditEntityQty(String(t.amountUSDT ?? t.qty ?? ''));
                                  setEditEntityPrice(String(t.sellPriceQAR ?? t.price ?? ''));
                                  setEditEntityReason('');
                                }}>
                                  <Edit className="h-3 w-3 mr-1" /> Edit
                                </Button>
                                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                {!t.voided && (
                                  <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2 text-destructive" onClick={() => {
                                    setVoidEntity({ type: 'trade', data: t });
                                    setVoidEntityReason('');
                                  }}>
                                    <Ban className="h-3 w-3 mr-1" /> Void
                                  </Button>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>
              <p className="text-[10px] text-muted-foreground">
                Last synced: {tracker.updated_at ? format(new Date(tracker.updated_at), 'MMM d, yyyy HH:mm') : 'â€”'}
              </p>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Edit Deal Dialog */}
      <Dialog open={!!editDeal} onOpenChange={(open) => !open && setEditDeal(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-sm">Correct Deal</DialogTitle>
            <DialogDescription className="text-xs">Changes are audited and permanent.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div><Label className="text-xs">Title</Label><Input value={editTitle} onChange={e => setEditTitle(e.target.value)} className="h-8 text-sm" /></div>
            <div><Label className="text-xs">Amount</Label><Input type="number" value={editAmount} onChange={e => setEditAmount(e.target.value)} className="h-8 text-sm" /></div>
            <div><Label className="text-xs">Reason (required)</Label><Textarea value={editReason} onChange={e => setEditReason(e.target.value)} placeholder="Why is this correction needed?" className="text-sm min-h-[60px]" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setEditDeal(null)}>Cancel</Button>
            <Button size="sm" onClick={handleCorrect} disabled={!editReason.trim() || correctDeal.isPending}>
              {correctDeal.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
              Save Correction
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Void Deal Dialog */}
      <Dialog open={!!voidTarget} onOpenChange={(open) => !open && setVoidTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-sm">Void Deal</DialogTitle>
            <DialogDescription className="text-xs">This will mark the deal as voided. This action is audited.</DialogDescription>
          </DialogHeader>
          <div>
            <Label className="text-xs">Reason (required)</Label>
            <Textarea value={voidReason} onChange={e => setVoidReason(e.target.value)} placeholder="Why is this deal being voided?" className="text-sm min-h-[60px]" />
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setVoidTarget(null)}>Cancel</Button>
            <Button variant="destructive" size="sm" onClick={handleVoid} disabled={!voidReason.trim() || voidDeal.isPending}>
              {voidDeal.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
              Confirm Void
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Tracker Entity Dialog */}
      <Dialog open={!!editEntity} onOpenChange={(open) => !open && setEditEntity(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-sm">Correct {editEntity?.type === 'batch' ? 'Batch' : 'Trade'}</DialogTitle>
            <DialogDescription className="text-xs">Changes are audited and permanent.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">{editEntity?.type === 'batch' ? 'Quantity' : 'Amount (USDT)'}</Label>
              <Input type="number" value={editEntityQty} onChange={e => setEditEntityQty(e.target.value)} className="h-8 text-sm" />
            </div>
            <div>
              <Label className="text-xs">{editEntity?.type === 'batch' ? 'Buy Price' : `Sell Price (${userBaseFiat})`}</Label>
              <Input type="number" value={editEntityPrice} onChange={e => setEditEntityPrice(e.target.value)} className="h-8 text-sm" />
            </div>
            <div>
              <Label className="text-xs">Reason (required)</Label>
              <Textarea value={editEntityReason} onChange={e => setEditEntityReason(e.target.value)} placeholder="Why is this correction needed?" className="text-sm min-h-[60px]" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setEditEntity(null)}>Cancel</Button>
            <Button size="sm" onClick={handleCorrectEntity} disabled={!editEntityReason.trim() || correctTracker.isPending}>
              {correctTracker.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
              Save Correction
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Void Tracker Entity Dialog */}
      <Dialog open={!!voidEntity} onOpenChange={(open) => !open && setVoidEntity(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-sm">Void {voidEntity?.type === 'batch' ? 'Batch' : 'Trade'}</DialogTitle>
            <DialogDescription className="text-xs">This will mark the record as voided. This action is audited.</DialogDescription>
          </DialogHeader>
          <div>
            <Label className="text-xs">Reason (required)</Label>
            <Textarea value={voidEntityReason} onChange={e => setVoidEntityReason(e.target.value)} placeholder="Why is this record being voided?" className="text-sm min-h-[60px]" />
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setVoidEntity(null)}>Cancel</Button>
            <Button variant="destructive" size="sm" onClick={handleVoidEntity} disabled={!voidEntityReason.trim() || voidTrackerEntity.isPending}>
              {voidTrackerEntity.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
              Confirm Void
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

