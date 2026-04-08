import { useState, useRef } from 'react';
import { useAuth } from '@/features/auth/auth-context';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Wallet, ArrowDownLeft, ArrowUpRight, Clock, Lock,
  CheckCircle2, Download, Receipt, Loader2, TrendingUp
} from 'lucide-react';
import { cn } from '@/lib/utils';

export default function CustomerWalletPage() {
  const { userId } = useAuth();
  const [receiptOrderId, setReceiptOrderId] = useState<string | null>(null);

  /* ── Server-calculated balances ─── */
  const { data: wallet, isLoading: walletLoading } = useQuery({
    queryKey: ['customer-wallet', userId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('customer_wallet_summary', {
        p_user_id: userId!,
      });
      if (error) throw error;
      return data as {
        available_balance: number;
        pending_balance: number;
        held_balance: number;
        total_completed: number;
        currency: string;
      };
    },
    enabled: !!userId,
  });

  /* ── Transaction history (completed/confirmed orders) ─── */
  const { data: transactions = [], isLoading: txLoading } = useQuery({
    queryKey: ['customer-transactions', userId],
    queryFn: async () => {
      const { data } = await supabase
        .from('customer_orders')
        .select('*')
        .eq('customer_user_id', userId!)
        .in('status', ['completed', 'confirmed', 'payment_sent', 'cancelled'])
        .order('created_at', { ascending: false })
        .limit(100);
      if (!data || data.length === 0) return [];
      // resolve merchant names
      const mids = [...new Set(data.map((o) => o.merchant_id))];
      const { data: profiles } = await supabase
        .from('merchant_profiles')
        .select('merchant_id, display_name')
        .in('merchant_id', mids);
      const nameMap = new Map((profiles ?? []).map((p) => [p.merchant_id, p.display_name]));
      return data.map((o) => ({ ...o, merchantName: nameMap.get(o.merchant_id) ?? o.merchant_id }));
    },
    enabled: !!userId,
  });

  const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  /* ── Receipt generator ─── */
  const receiptOrder = transactions.find((t: any) => t.id === receiptOrderId);

  const downloadReceipt = () => {
    if (!receiptOrder) return;
    const receiptId = `RCP-${receiptOrder.id.slice(0, 8).toUpperCase()}`;
    const lines = [
      '═══════════════════════════════════════',
      '             SETTLEMENT RECEIPT',
      '═══════════════════════════════════════',
      '',
      `Receipt ID:    ${receiptId}`,
      `Date:          ${new Date(receiptOrder.created_at).toLocaleString()}`,
      `Type:          ${receiptOrder.order_type.toUpperCase()}`,
      `Merchant:      ${receiptOrder.merchantName}`,
      `Amount:        ${receiptOrder.amount} ${receiptOrder.currency}`,
      `Rate:          ${receiptOrder.rate ?? 'Market'}`,
      `Total:         ${receiptOrder.total ? fmt(receiptOrder.total) : 'N/A'}`,
      `Status:        ${receiptOrder.status.toUpperCase()}`,
      '',
      '═══════════════════════════════════════',
      '  This is a system-generated receipt.',
      '═══════════════════════════════════════',
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${receiptId}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    setReceiptOrderId(null);
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold flex items-center gap-2">
        <Wallet className="h-6 w-6" /> Wallet
      </h1>

      {/* Balance cards */}
      {walletLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : wallet ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle2 className="h-4 w-4 text-primary" />
                <span className="text-xs text-muted-foreground uppercase tracking-wide">Available</span>
              </div>
              <p className="text-2xl font-bold">{fmt(wallet.available_balance)}</p>
              <p className="text-xs text-muted-foreground">{wallet.currency}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <Clock className="h-4 w-4 text-amber-500" />
                <span className="text-xs text-muted-foreground uppercase tracking-wide">Pending</span>
              </div>
              <p className="text-2xl font-bold">{fmt(wallet.pending_balance)}</p>
              <p className="text-xs text-muted-foreground">{wallet.currency}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <Lock className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground uppercase tracking-wide">Held</span>
              </div>
              <p className="text-2xl font-bold">{fmt(wallet.held_balance)}</p>
              <p className="text-xs text-muted-foreground">{wallet.currency}</p>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {/* Stats */}
      {wallet && (
        <Card>
          <CardContent className="flex items-center gap-3 p-3">
            <TrendingUp className="h-4 w-4 text-primary" />
            <span className="text-sm"><span className="font-bold">{wallet.total_completed}</span> completed transactions</span>
          </CardContent>
        </Card>
      )}

      {/* Transaction history */}
      <div>
        <h2 className="text-lg font-semibold mb-3">Transaction History</h2>
        {txLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : transactions.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center py-10 text-center">
              <Receipt className="h-10 w-10 text-muted-foreground/40 mb-2" />
              <p className="text-muted-foreground text-sm">No transactions yet</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {transactions.map((tx: any) => (
              <Card key={tx.id}>
                <CardContent className="p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        'flex h-8 w-8 items-center justify-center rounded-full shrink-0',
                        tx.order_type === 'buy' ? 'bg-primary/10 text-primary' : 'bg-destructive/10 text-destructive'
                      )}>
                        {tx.order_type === 'buy' ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">
                          {tx.order_type === 'buy' ? '+' : '−'}{tx.amount} {tx.currency}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {tx.merchantName} · {new Date(tx.created_at).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge
                        variant={tx.status === 'completed' ? 'default' : tx.status === 'cancelled' ? 'destructive' : 'secondary'}
                        className="text-xs capitalize"
                      >
                        {tx.status}
                      </Badge>
                      {tx.status === 'completed' && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={(e) => {
                            e.stopPropagation();
                            setReceiptOrderId(tx.id);
                          }}
                          title="Download receipt"
                        >
                          <Download className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                  {tx.rate && (
                    <p className="text-xs text-muted-foreground mt-1 pl-11">
                      Rate: {tx.rate} · Total: {tx.total ? fmt(tx.total) : '—'}
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Receipt download dialog */}
      {receiptOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
          <Card className="w-full max-w-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Receipt className="h-4 w-4" /> Settlement Receipt
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1 text-sm">
                <Row label="Receipt ID" value={`RCP-${receiptOrder.id.slice(0, 8).toUpperCase()}`} />
                <Row label="Type" value={receiptOrder.order_type.toUpperCase()} />
                <Row label="Amount" value={`${receiptOrder.amount} ${receiptOrder.currency}`} />
                <Row label="Rate" value={receiptOrder.rate ?? 'Market'} />
                <Row label="Total" value={receiptOrder.total ? fmt(receiptOrder.total) : 'N/A'} />
                <Row label="Merchant" value={receiptOrder.merchantName} />
                <Row label="Date" value={new Date(receiptOrder.created_at).toLocaleString()} />
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setReceiptOrderId(null)}>
                  Close
                </Button>
                <Button className="flex-1 gap-1" onClick={downloadReceipt}>
                  <Download className="h-4 w-4" /> Download
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-right">{String(value)}</span>
    </div>
  );
}
