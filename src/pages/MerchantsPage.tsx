import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useTheme } from '@/lib/theme-context';
import { useAuth } from '@/features/auth/auth-context';
import { useT } from '@/lib/i18n';
import { supabase } from '@/integrations/supabase/client';
import { fmtU, fmtDate } from '@/lib/tracker-helpers';
import { DEAL_TYPE_CONFIGS } from '@/lib/deal-engine';
import { toast } from 'sonner';
import '@/styles/tracker.css';

type MerchantTab = 'relationships' | 'agreements' | 'ledger' | 'analytics';

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
  order_count?: number;
}

export default function MerchantsPage() {
  const { settings } = useTheme();
  const { userId, merchantProfile } = useAuth();
  const t = useT();

  const [tab, setTab] = useState<MerchantTab>('relationships');
  const [relationships, setRelationships] = useState<any[]>([]);
  const [agreements, setAgreements] = useState<AgreementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');



  useEffect(() => {
    loadData();
  }, [userId]);

  const loadData = async () => {
    if (!userId) return;
    setLoading(true);
    try {
      // Load relationships
      const { data: rels } = await supabase
        .from('merchant_relationships')
        .select('*')
        .order('created_at', { ascending: false });

      // Load deals as agreements
      const { data: deals } = await supabase
        .from('merchant_deals')
        .select('*')
        .order('created_at', { ascending: false });

      // Load merchant profiles for counterparty names
      const { data: profiles } = await supabase
        .from('merchant_profiles')
        .select('merchant_id, display_name, nickname');

      const profileMap = new Map(
        (profiles || []).map(p => [p.merchant_id, p])
      );

      const myMerchantId = merchantProfile?.merchant_id;

      const enrichedRels = (rels || []).map(r => {
        const counterpartyId = r.merchant_a_id === myMerchantId ? r.merchant_b_id : r.merchant_a_id;
        const cp = profileMap.get(counterpartyId);
        return {
          ...r,
          counterparty_name: cp?.display_name || counterpartyId,
          counterparty_nickname: cp?.nickname || '',
        };
      });

      const enrichedDeals: AgreementRow[] = (deals || []).map(d => {
        const rel = enrichedRels.find(r => r.id === d.relationship_id);
        return {
          id: d.id,
          relationship_id: d.relationship_id,
          title: d.title,
          deal_type: d.deal_type,
          amount: d.amount,
          currency: d.currency,
          status: d.status,
          created_at: d.created_at,
          counterparty_name: rel?.counterparty_name || '—',
          order_count: 0, // Would need orders table to calculate
        };
      });

      setRelationships(enrichedRels);
      setAgreements(enrichedDeals);
    } catch (err) {
      console.error('Failed to load merchant data:', err);
    } finally {
      setLoading(false);
    }
  };

  const filteredRels = search
    ? relationships.filter(r =>
        r.counterparty_name?.toLowerCase().includes(search.toLowerCase()) ||
        r.counterparty_nickname?.toLowerCase().includes(search.toLowerCase())
      )
    : relationships;

  const filteredAgreements = search
    ? agreements.filter(a =>
        a.title.toLowerCase().includes(search.toLowerCase()) ||
        a.counterparty_name?.toLowerCase().includes(search.toLowerCase())
      )
    : agreements;

  const statusPill = (status: string) => {
    const cls = status === 'active' || status === 'approved' ? 'good'
      : status === 'pending' ? 'warn'
      : status === 'rejected' || status === 'cancelled' ? 'bad'
      : '';
    return <span className={`pill ${cls}`}>{status}</span>;
  };

  const dealTypeLabel = (dt: string) => {
    const cfg = DEAL_TYPE_CONFIGS[dt as keyof typeof DEAL_TYPE_CONFIGS];
    return cfg ? `${cfg.icon} ${cfg.label}` : dt;
  };



  const handleArchiveAgreement = async (id: string) => {
    try {
      const { error } = await supabase
        .from('merchant_deals')
        .update({ status: 'cancelled' })
        .eq('id', id);
      if (error) throw error;
      toast.success(t('agreementArchived') || 'Agreement archived');
      loadData();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleApproveAgreement = async (id: string) => {
    try {
      const { error } = await supabase
        .from('merchant_deals')
        .update({ status: 'active' })
        .eq('id', id);
      if (error) throw error;
      toast.success(t('agreementApproved') || 'Agreement approved');
      loadData();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  // Analytics
  const totalAgreements = agreements.length;
  const activeAgreements = agreements.filter(a => a.status === 'active').length;
  const pendingAgreements = agreements.filter(a => a.status === 'pending').length;
  const totalExposure = agreements.filter(a => a.status === 'active').reduce((s, a) => s + a.amount, 0);

  // Cancelled deals for ledger
  const cancelledDeals = agreements.filter(a => a.status === 'cancelled');

  const tabs: { key: MerchantTab; label: string; icon: string }[] = [
    { key: 'relationships', label: t('relationships') || 'Relationships', icon: '👥' },
    { key: 'agreements', label: t('agreements') || 'Agreements', icon: '🤝' },
    { key: 'ledger', label: t('ledger') || 'Ledger', icon: '📒' },
    { key: 'analytics', label: t('analytics'), icon: '📊' },
  ];

  return (
    <div className="tracker-root" dir={t.isRTL ? 'rtl' : 'ltr'} style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10, minHeight: '100%' }}>

      {/* ─── HEADER ─── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 800 }}>🏪 {t('theMerchants') || 'The Merchants'}</div>
          <div style={{ fontSize: 10, color: 'var(--muted)' }}>{t('merchantOrchestratorDesc') || 'Relationship & agreement orchestration hub'}</div>
        </div>
        <div className="inputBox" style={{ maxWidth: 240, padding: '6px 10px' }}>
          <input
            placeholder={t('search') || 'Search...'}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* ─── TAB BAR ─── */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--line)', marginBottom: 2 }}>
        {tabs.map(({ key, label, icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              padding: '9px 18px', fontSize: 11, fontWeight: tab === key ? 700 : 500,
              color: tab === key ? 'var(--brand)' : 'var(--muted)',
              borderBottom: tab === key ? '2px solid var(--brand)' : '2px solid transparent',
              background: 'transparent', border: 'none', borderBottomStyle: 'solid', cursor: 'pointer',
              transition: 'all 0.15s', letterSpacing: '.2px',
            }}
          >
            {icon} {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="empty">
          <div className="empty-t">{t('loading') || 'Loading...'}</div>
        </div>
      ) : (
        <>
          {/* ═══ RELATIONSHIPS TAB ═══ */}
          {tab === 'relationships' && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>{t('activeRelationships') || 'Active Relationships'}</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)' }}>{filteredRels.length} {t('merchants') || 'merchants'}</div>
                </div>
              </div>

              {filteredRels.length === 0 ? (
                <div className="empty">
                  <div className="empty-t">{t('noRelationships') || 'No relationships yet'}</div>
                  <div className="empty-s">{t('sendInviteToStart') || 'Send an invite to start collaborating'}</div>
                </div>
              ) : (
                <div className="tableWrap">
                  <table>
                    <thead>
                      <tr>
                        <th>{t('merchant') || 'Merchant'}</th>
                        <th>{t('status')}</th>
                        <th className="r">{t('agreements') || 'Agreements'}</th>
                        <th>{t('since') || 'Since'}</th>
                        <th>{t('actions')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRels.map(r => {
                        const relDeals = agreements.filter(a => a.relationship_id === r.id);
                        return (
                          <tr key={r.id}>
                            <td>
                              <div style={{ fontWeight: 700, fontSize: 11 }}>{r.counterparty_name}</div>
                              <div style={{ fontSize: 9, color: 'var(--muted)' }}>@{r.counterparty_nickname}</div>
                            </td>
                            <td>{statusPill(r.status)}</td>
                            <td className="mono r">{relDeals.length}</td>
                            <td className="mono">{new Date(r.created_at).toLocaleDateString()}</td>
                            <td>
                              <div style={{ display: 'flex', gap: 4 }}>
                                <button className="rowBtn" onClick={() => { setTab('agreements'); setSearch(r.counterparty_name); }}>
                                  {t('viewDeals') || 'Deals'}
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}



          {/* ═══ AGREEMENTS TAB ═══ */}
          {tab === 'agreements' && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>{t('merchantAgreements') || 'Merchant Agreements'}</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)' }}>{filteredAgreements.length} {t('total') || 'total'}</div>
                </div>
              </div>

              {filteredAgreements.length === 0 ? (
                <div className="empty">
                  <div className="empty-t">{t('noAgreements') || 'No agreements yet'}</div>
                  <div className="empty-s">{t('createFirstAgreement') || 'Create your first merchant agreement'}</div>
                </div>
              ) : (
                <div className="tableWrap">
                  <table>
                    <thead>
                      <tr>
                        <th>{t('title') || 'Title'}</th>
                        <th>{t('merchant') || 'Merchant'}</th>
                        <th>{t('type') || 'Type'}</th>
                        <th className="r">{t('amount')}</th>
                        <th>{t('status')}</th>
                        <th>{t('date')}</th>
                        <th>{t('actions')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredAgreements.map(a => (
                        <tr key={a.id}>
                          <td style={{ fontWeight: 700, fontSize: 11 }}>{a.title}</td>
                          <td style={{ fontSize: 10 }}>{a.counterparty_name}</td>
                          <td style={{ fontSize: 10 }}>{dealTypeLabel(a.deal_type)}</td>
                          <td className="mono r">{fmtU(a.amount)} {a.currency}</td>
                          <td>{statusPill(a.status)}</td>
                          <td className="mono" style={{ fontSize: 10 }}>{new Date(a.created_at).toLocaleDateString()}</td>
                          <td>
                            <div style={{ display: 'flex', gap: 4 }}>
                              {a.status === 'pending' && (
                                <button className="rowBtn" onClick={() => handleApproveAgreement(a.id)}>
                                  ✓ {t('approve') || 'Approve'}
                                </button>
                              )}
                              {a.status !== 'cancelled' && (
                                <button className="rowBtn" onClick={() => handleArchiveAgreement(a.id)}>
                                  {t('archive') || 'Archive'}
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {/* ═══ ANALYTICS TAB ═══ */}
          {tab === 'analytics' && (
            <>
              <div style={{ marginBottom: 4 }}>
                <div style={{ fontSize: 12, fontWeight: 700 }}>{t('merchantAnalytics') || 'Merchant Analytics'}</div>
                <div style={{ fontSize: 10, color: 'var(--muted)' }}>{t('overviewOfAgreements') || 'Overview of agreements & relationships'}</div>
              </div>

              <div className="kpi-band-grid">
                <div className="kpi-band">
                  <div className="kpi-band-title">{t('totalAgreements') || 'TOTAL AGREEMENTS'}</div>
                  <div className="kpi-band-cols">
                    <div>
                      <div className="kpi-period">{t('total') || 'TOTAL'}</div>
                      <div className="kpi-cell-val">{totalAgreements}</div>
                    </div>
                    <div>
                      <div className="kpi-period">{t('activeLabel') || 'ACTIVE'}</div>
                      <div className="kpi-cell-val" style={{ color: 'var(--good)' }}>{activeAgreements}</div>
                    </div>
                  </div>
                </div>
                <div className="kpi-band">
                  <div className="kpi-band-title">{t('exposure') || 'EXPOSURE'}</div>
                  <div className="kpi-band-cols">
                    <div>
                      <div className="kpi-period">{t('pending') || 'PENDING'}</div>
                      <div className="kpi-cell-val" style={{ color: 'var(--warn)' }}>{pendingAgreements}</div>
                    </div>
                    <div>
                      <div className="kpi-period">{t('totalExposure') || 'TOTAL'}</div>
                      <div className="kpi-cell-val">{fmtU(totalExposure)} USDT</div>
                    </div>
                  </div>
                </div>
              </div>

              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6 }}>{t('relationshipBreakdown') || 'Relationship Breakdown'}</div>
                <div className="tableWrap">
                  <table>
                    <thead>
                      <tr>
                        <th>{t('merchant') || 'Merchant'}</th>
                        <th className="r">{t('agreements') || 'Agreements'}</th>
                        <th className="r">{t('activeExposure') || 'Active Exposure'}</th>
                        <th>{t('status')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {relationships.map(r => {
                        const relDeals = agreements.filter(a => a.relationship_id === r.id);
                        const activeExp = relDeals.filter(a => a.status === 'active').reduce((s, a) => s + a.amount, 0);
                        return (
                          <tr key={r.id}>
                            <td style={{ fontWeight: 700, fontSize: 11 }}>{r.counterparty_name}</td>
                            <td className="mono r">{relDeals.length}</td>
                            <td className="mono r">{fmtU(activeExp)} USDT</td>
                            <td>{statusPill(r.status)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </>
      )}

    </div>
  );
}
