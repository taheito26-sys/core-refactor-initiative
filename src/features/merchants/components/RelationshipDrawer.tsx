import { useT } from '@/lib/i18n';
import { useAuth } from '@/features/auth/auth-context';
import { DealsTab } from './DealsTab';
import { SettlementTab } from './SettlementTab';
import { ProfitDistributionPanel } from './ProfitDistributionPanel';
import { CapitalPoolPanel } from './CapitalPoolPanel';
import { BalanceLedger } from './BalanceLedger';
import { ChatTab } from './ChatTab';
import { useState, useMemo } from 'react';
import '@/styles/tracker.css';

interface AgreementRow {
  id: string;
  relationship_id: string;
  title: string;
  deal_type: string;
  amount: number;
  currency: string;
  status: string;
  created_at: string;
  counterparty_name?: string;
  settlement_cadence?: string;
}

interface RelationshipDrawerProps {
  relationship: {
    id: string;
    counterparty_name: string;
    counterparty_nickname: string;
    counterparty_code: string;
    status: string;
    created_at: string;
    merchant_a_id: string;
    merchant_b_id: string;
  };
  agreements: AgreementRow[];
  onClose: () => void;
  trackerTrades?: Array<{
    id: string;
    ts: number;
    linkedDealId?: string;
    amountUSDT: number;
    sellPriceQAR: number;
    feeQAR: number;
    voided: boolean;
  }>;
  tradeCalc?: Map<string, any>;
}

type DrawerTab = 'deals' | 'settlements' | 'pnl' | 'capital' | 'chat';

export function RelationshipDrawer({ relationship, agreements, onClose, trackerTrades, tradeCalc }: RelationshipDrawerProps) {
  const t = useT();
  const { merchantProfile } = useAuth();
  const [activeTab, setActiveTab] = useState<DrawerTab>('deals');

  const relDeals = useMemo(() =>
    agreements
      .filter(a => a.relationship_id === relationship.id && a.status !== 'cancelled')
      .map(d => ({
        id: d.id,
        title: d.title,
        deal_type: d.deal_type,
        settlement_cadence: d.settlement_cadence || 'monthly',
        amount: d.amount,
        created_at: d.created_at,
      })),
    [agreements, relationship.id]
  );

  const isPartner = merchantProfile?.merchant_id !== relationship.merchant_a_id;

  const tabs: { key: DrawerTab; label: string; icon: string }[] = [
    { key: 'deals', label: t('dealsLabel'), icon: '📋' },
    { key: 'settlements', label: t('settlements'), icon: '💰' },
    { key: 'pnl', label: t('pnl'), icon: '📊' },
    { key: 'capital', label: t('capitalTab'), icon: '🏦' },
    { key: 'chat', label: t('chatTab'), icon: '💬' },
  ];

  return (
    <>
      {/* Backdrop */}
      <div className="rel-drawer-backdrop" onClick={onClose} />

      {/* Drawer */}
      <div className="rel-drawer tracker-root" dir={t.isRTL ? 'rtl' : 'ltr'}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <button className="rowBtn" onClick={onClose} style={{ fontSize: 14 }}>←</button>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 800 }}>{relationship.counterparty_name}</div>
            <div style={{ fontSize: 10, color: 'var(--muted)' }}>
              @{relationship.counterparty_nickname} · {t('code') || 'Code'}: <span className="mono" style={{ fontWeight: 700 }}>{relationship.counterparty_code || '—'}</span>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
            <span className={`pill ${relationship.status === 'active' ? 'good' : 'warn'}`}>{relationship.status}</span>
            <span style={{ fontSize: 9, color: 'var(--muted)' }}>
              {t('since') || 'Since'}: {new Date(relationship.created_at).toLocaleDateString()}
            </span>
          </div>
        </div>

        {/* Tab bar */}
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

        {/* Tab content */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {activeTab === 'deals' && (
            <DealsTab
              relationshipId={relationship.id}
              agreements={agreements}
            />
          )}
          {activeTab === 'settlements' && (
            <SettlementTab
              relationshipId={relationship.id}
              deals={relDeals}
              isPartner={isPartner}
              trades={trackerTrades || []}
              tradeCalc={tradeCalc || new Map()}
            />
          )}
          {activeTab === 'pnl' && (
            <ProfitDistributionPanel relationshipId={relationship.id} />
          )}
          {activeTab === 'capital' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* Unified balance ledger */}
              <BalanceLedger relationshipId={relationship.id} />

              {/* Per-deal capital pools (exclude capital_transfer deals) */}
              {relDeals.filter(d => d.deal_type !== 'capital_transfer').length > 0 && (
                <>
                  <div style={{ fontSize: 11, fontWeight: 700, marginTop: 8 }}>{t('perDealCapital') || 'Per-Deal Capital'}</div>
                  {relDeals.filter(d => d.deal_type !== 'capital_transfer').map(d => (
                    <CapitalPoolPanel
                      key={d.id}
                      dealId={d.id}
                      dealAmount={d.amount}
                      dealTitle={d.title}
                      relationshipId={relationship.id}
                      isPartner={isPartner}
                    />
                  ))}
                </>
              )}

              {relDeals.filter(d => d.deal_type !== 'capital_transfer').length === 0 && (
                <div className="empty">
                  <div className="empty-t">{t('noDeals')}</div>
                </div>
              )}
            </div>
          )}
          {activeTab === 'chat' && (
            <ChatTab relationshipId={relationship.id} />
          )}
        </div>
      </div>
    </>
  );
}
