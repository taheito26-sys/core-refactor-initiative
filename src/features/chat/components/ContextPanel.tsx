/* ═══════════════════════════════════════════════════════════════
   ContextPanel — Right panel showing real orders, agreements,
   and settlement status for the selected relationship.
   Items are clickable: orders → /orders, agreements → drawer.
   ═══════════════════════════════════════════════════════════════ */

import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Package, FileText, Receipt, Loader2, ExternalLink } from 'lucide-react';

interface Relationship {
  id: string;
  counterparty_name: string;
  counterparty_nickname: string;
  counterparty_code?: string;
  merchant_a_id: string;
  merchant_b_id: string;
}

interface Props {
  relationship: Relationship | null;
  onOpenRelationship?: (relationshipId: string) => void;
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'text-amber-400',
  active: 'text-emerald-400',
  approved: 'text-emerald-400',
  completed: 'text-primary',
  settled: 'text-primary',
  due: 'text-destructive',
  overdue: 'text-destructive',
  rejected: 'text-destructive',
  expired: 'text-muted-foreground',
  cancelled: 'text-muted-foreground',
  disputed: 'text-amber-400',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`font-semibold capitalize text-[10px] ${STATUS_COLORS[status] || 'text-muted-foreground'}`}>
      {status}
    </span>
  );
}

export function ContextPanel({ relationship, onOpenRelationship }: Props) {
  const navigate = useNavigate();
  const relId = relationship?.id;

  const { data: orders = [], isLoading: ordersLoading } = useQuery({
    queryKey: ['context-orders', relId],
    queryFn: async () => {
      const { data } = await supabase
        .from('merchant_deals')
        .select('id, title, amount, currency, status, deal_type, created_at')
        .eq('relationship_id', relId!)
        .order('created_at', { ascending: false })
        .limit(5);
      return data || [];
    },
    enabled: !!relId,
    staleTime: 15_000,
  });

  const { data: agreements = [], isLoading: agreementsLoading } = useQuery({
    queryKey: ['context-agreements', relId],
    queryFn: async () => {
      const { data } = await supabase
        .from('profit_share_agreements')
        .select('id, merchant_ratio, partner_ratio, settlement_cadence, status, effective_from, expires_at')
        .eq('relationship_id', relId!)
        .order('created_at', { ascending: false })
        .limit(5);
      return data || [];
    },
    enabled: !!relId,
    staleTime: 15_000,
  });

  const { data: settlements = [], isLoading: settlementsLoading } = useQuery({
    queryKey: ['context-settlements', relId],
    queryFn: async () => {
      const { data } = await supabase
        .from('settlement_periods')
        .select('id, period_key, status, net_profit, settled_amount, cadence, resolution')
        .eq('relationship_id', relId!)
        .order('created_at', { ascending: false })
        .limit(5);
      return data || [];
    },
    enabled: !!relId,
    staleTime: 15_000,
  });

  if (!relationship) {
    return (
      <div className="w-[260px] flex-shrink-0 border-l border-border hidden lg:flex items-center justify-center text-muted-foreground text-xs p-5 bg-card">
        Select a conversation to see details
      </div>
    );
  }

  const isLoading = ordersLoading || agreementsLoading || settlementsLoading;

  const handleOrderClick = (orderId: string) => {
    navigate(`/orders?deal=${orderId}`);
  };

  const handleAgreementClick = () => {
    if (onOpenRelationship && relId) {
      onOpenRelationship(relId);
    } else {
      navigate(`/merchants?rel=${relId}&tab=deals`);
    }
  };

  const handleSettlementClick = () => {
    navigate(`/merchants?rel=${relId}&tab=settlements`);
  };

  return (
    <div className="w-[260px] flex-shrink-0 border-l border-border overflow-y-auto bg-card h-full hidden lg:block">
      <div className="p-3 space-y-3">

        {/* ── Orders ── */}
        <Section icon={Package} title="Recent Orders" count={orders.length} loading={isLoading}>
          {orders.length === 0 ? (
            <Empty>No orders yet</Empty>
          ) : (
            orders.map((o: any) => (
              <button
                key={o.id}
                onClick={() => handleOrderClick(o.id)}
                className="rounded border border-border bg-background p-2.5 space-y-1 w-full text-left hover:border-primary/40 hover:bg-accent/30 transition-colors cursor-pointer group"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-foreground truncate flex-1 group-hover:text-primary transition-colors">{o.title}</span>
                  <ExternalLink size={10} className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity ml-1 flex-shrink-0" />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-muted-foreground">
                    {Number(o.amount).toLocaleString()} {o.currency}
                  </span>
                  <StatusBadge status={o.status} />
                </div>
              </button>
            ))
          )}
        </Section>

        {/* ── Agreements ── */}
        <Section icon={FileText} title="Agreements" count={agreements.length} loading={isLoading}>
          {agreements.length === 0 ? (
            <Empty>No agreements</Empty>
          ) : (
            agreements.map((a: any) => (
              <button
                key={a.id}
                onClick={handleAgreementClick}
                className="rounded border border-border bg-background p-2.5 space-y-1 w-full text-left hover:border-primary/40 hover:bg-accent/30 transition-colors cursor-pointer group"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-foreground group-hover:text-primary transition-colors">
                    {a.merchant_ratio}/{a.partner_ratio} split
                  </span>
                  <StatusBadge status={a.status} />
                </div>
                <div className="text-[10px] text-muted-foreground capitalize">
                  {a.settlement_cadence} settlement
                </div>
              </button>
            ))
          )}
        </Section>

        {/* ── Settlements ── */}
        <Section icon={Receipt} title="Settlements" count={settlements.length} loading={isLoading}>
          {settlements.length === 0 ? (
            <Empty>No settlement periods</Empty>
          ) : (
            settlements.map((s: any) => (
              <button
                key={s.id}
                onClick={handleSettlementClick}
                className="rounded border border-border bg-background p-2.5 space-y-1 w-full text-left hover:border-primary/40 hover:bg-accent/30 transition-colors cursor-pointer group"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-foreground group-hover:text-primary transition-colors">{s.period_key}</span>
                  <ExternalLink size={10} className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity ml-1 flex-shrink-0" />
                </div>
                <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>Net: {Number(s.net_profit).toLocaleString()}</span>
                  {s.resolution && (
                    <span className="capitalize text-primary font-semibold">{s.resolution}</span>
                  )}
                </div>
              </button>
            ))
          )}
        </Section>
      </div>
    </div>
  );
}

/* ── Helpers ── */

function Section({ icon: Icon, title, count, loading, children }: {
  icon: any; title: string; count: number; loading: boolean; children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5">
        <Icon size={12} className="text-muted-foreground" />
        <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{title}</span>
        {!loading && <span className="text-[10px] text-muted-foreground">({count})</span>}
        {loading && <Loader2 size={10} className="animate-spin text-muted-foreground" />}
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-[10px] text-muted-foreground py-2 text-center">{children}</div>;
}
