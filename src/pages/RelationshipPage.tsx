import { useState, useMemo, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/features/auth/auth-context';
import { useT } from '@/lib/i18n';
import { supabase } from '@/integrations/supabase/client';
import { AgreementsTab } from '@/features/merchants/components/AgreementsTab';
import { SettlementTab } from '@/features/merchants/components/SettlementTab';
import { ChatTab } from '@/features/merchants/components/ChatTab';
import { useTrackerState } from '@/lib/useTrackerState';
import { fmtTotal } from '@/lib/tracker-helpers';
import '@/styles/tracker.css';

type WorkspaceTab = 'agreements' | 'settlements' | 'chat';

interface LegacyDealRow {
  id: string;
  relationship_id: string;
  title: string;
  deal_type: string;
  amount: number;
  currency: string;
  status: string;
  created_at: string;
  settlement_cadence?: string;
}

export default function RelationshipPage() {
  const { relationshipId } = useParams<{ relationshipId: string }>();
  const navigate = useNavigate();
  const { userId, merchantProfile } = useAuth();
  const t = useT();
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('agreements');
  const [relationship, setRelationship] = useState<any>(null);
  const [legacyDeals, setLegacyDeals] = useState<LegacyDealRow[]>([]);
  const [loading, setLoading] = useState(true);

  const { state: trackerState, derived: trackerDerived } = useTrackerState({});

  useEffect(() => {
    if (!relationshipId || !userId) return;
    loadData();
  }, [relationshipId, userId, merchantProfile?.merchant_id]);

  const loadData = async () => {
    if (!relationshipId || !userId) return;
    setLoading(true);
    try {
      const myMerchantId = merchantProfile?.merchant_id;

      const [relRes, dealsRes, profilesRes] = await Promise.all([
        supabase.from('merchant_relationships').select('*').eq('id', relationshipId).single(),
        supabase.from('merchant_deals').select('*').eq('relationship_id', relationshipId).order('created_at', { ascending: false }),
        supabase.from('merchant_profiles').select('merchant_id, display_name, nickname, merchant_code'),
      ]);

      if (relRes.error || !relRes.data) {
        navigate('/merchants');
        return;
      }

      const profileMap = new Map((profilesRes.data || []).map(p => [p.merchant_id, p]));
      const r = relRes.data;
      const cpId = r.merchant_a_id === myMerchantId ? r.merchant_b_id : r.merchant_a_id;
      const cp = profileMap.get(cpId);

      setRelationship({
        ...r,
        counterparty_name: cp?.display_name || cpId,
        counterparty_nickname: cp?.nickname || '',
        counterparty_code: (cp as any)?.merchant_code || '',
      });

      setLegacyDeals((dealsRes.data || []).map(d => ({
        id: d.id,
        relationship_id: d.relationship_id,
        title: d.title,
        deal_type: d.deal_type,
        amount: d.amount,
        currency: d.currency,
        status: d.status,
        created_at: d.created_at,
        settlement_cadence: (d as any).settlement_cadence || 'monthly',
      })));
    } catch (err) {
      console.error('Failed to load relationship:', err);
      navigate('/merchants');
    } finally {
      setLoading(false);
    }
  };

  const relDeals = useMemo(() =>
    legacyDeals
      .filter(a => a.relationship_id === relationshipId && a.status !== 'cancelled')
      .map(d => ({
        id: d.id,
        title: d.title,
        deal_type: d.deal_type,
        settlement_cadence: d.settlement_cadence || 'monthly',
        amount: d.amount,
        created_at: d.created_at,
      })),
    [legacyDeals, relationshipId]
  );

  const isPartner = relationship
    ? merchantProfile?.merchant_id !== relationship.merchant_a_id
    : false;

  const tabs: { key: WorkspaceTab; label: string; icon: string }[] = [
    { key: 'agreements', label: t('profitShareAgreements'), icon: '🤝' },
    { key: 'settlements', label: t('settlements'), icon: '💰' },
    { key: 'chat', label: t('chatTab'), icon: '💬' },
  ];

  if (loading) {
    return (
      <div className="tracker-root" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10, minHeight: '100%' }}>
        <div className="empty">
          <div className="empty-t">{t('loading') || 'Loading...'}</div>
        </div>
      </div>
    );
  }

  if (!relationship) return null;

  return (
    <div className="tracker-root" dir={t.isRTL ? 'rtl' : 'ltr'} style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 0, minHeight: '100%' }}>

      {/* ─── HEADER ─── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <button className="rowBtn" onClick={() => navigate('/merchants')} style={{ fontSize: 14, flexShrink: 0 }}>←</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {relationship.counterparty_name}
          </div>
          <div style={{ fontSize: 10, color: 'var(--muted)' }}>
            @{relationship.counterparty_nickname} · {t('code') || 'Code'}:{' '}
            <span className="mono" style={{ fontWeight: 700 }}>{relationship.counterparty_code || '—'}</span>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, flexShrink: 0 }}>
          <span className={`pill ${relationship.status === 'active' ? 'good' : 'warn'}`}>{relationship.status}</span>
          <span style={{ fontSize: 9, color: 'var(--muted)' }}>
            {t('since') || 'Since'}: {new Date(relationship.created_at).toLocaleDateString()}
          </span>
        </div>
      </div>

      {/* ─── MERCHANT TREASURY PANEL ─── */}
      {(() => {
        const linkedAccounts = (trackerState.cashAccounts || []).filter(a => a.relationshipId === relationshipId);
        if (linkedAccounts.length === 0) return null;

        const ledger = trackerState.cashLedger || [];
        const totals = new Map<string, number>();
        let lastRecon = 0;

        linkedAccounts.forEach(acc => {
          const bal = (ledger || [])
            .filter(e => e.accountId === acc.id)
            .reduce((sum, e) => sum + (e.direction === 'in' ? e.amount : -e.amount), 0);
          totals.set(acc.currency, (totals.get(acc.currency) || 0) + bal);
          if (acc.lastReconciled && acc.lastReconciled > lastRecon) lastRecon = acc.lastReconciled;
        });

        return (
          <div className="panel" style={{ marginBottom: 12, border: '1px solid color-mix(in srgb, var(--brand) 30%, transparent)', background: 'color-mix(in srgb, var(--brand) 4%, transparent)' }}>
            <div style={{ padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 10, color: 'var(--brand)', fontWeight: 800, textTransform: 'uppercase', marginBottom: 2, letterSpacing: '0.05em' }}>
                  {t('merchantTreasury' as any) || 'Merchant Treasury'}
                </div>
                <div style={{ display: 'flex', gap: 14 }}>
                  {Array.from(totals.entries()).map(([curr, amt]) => (
                    <div key={curr} className="mono" style={{ fontSize: 18, fontWeight: 900 }}>
                      {fmtTotal(amt)} <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--muted)' }}>{curr}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 9, color: 'var(--muted)', marginBottom: 2 }}>{t('lastReconciled' as any) || 'Last Reconciled'}</div>
                <div style={{ fontSize: 10, fontWeight: 600, color: lastRecon ? 'var(--text)' : 'var(--warn)' }}>
                  {lastRecon ? new Date(lastRecon).toLocaleDateString() : 'Never'}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ─── TAB BAR ─── */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--line)', marginBottom: 12, overflowX: 'auto' }}>
        {tabs.map(({ key, label, icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            style={{
              padding: '8px 12px', fontSize: 10, fontWeight: activeTab === key ? 700 : 500,
              color: activeTab === key ? 'var(--brand)' : 'var(--muted)',
              borderBottom: activeTab === key ? '2px solid var(--brand)' : '2px solid transparent',
              background: 'transparent', border: 'none', borderBottomStyle: 'solid', cursor: 'pointer',
              transition: 'all 0.15s',
              display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap',
            }}
          >
            {icon} {label}
          </button>
        ))}
      </div>

      {/* ─── TAB CONTENT ─── */}
      <div style={{ flex: 1 }}>
        {activeTab === 'agreements' && (
          <AgreementsTab
            relationshipId={relationship.id}
            counterpartyName={relationship.counterparty_name}
          />
        )}
        {activeTab === 'settlements' && (
          <SettlementTab
            relationshipId={relationship.id}
            deals={relDeals}
            isPartner={isPartner}
            trades={trackerState.trades || []}
            tradeCalc={trackerDerived.tradeCalc || new Map()}
          />
        )}
        {activeTab === 'chat' && (
          <ChatTab relationshipId={relationship.id} />
        )}
      </div>
    </div>
  );
}
