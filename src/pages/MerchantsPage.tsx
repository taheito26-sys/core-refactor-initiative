import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTheme } from '@/lib/theme-context';
import { useAuth } from '@/features/auth/auth-context';
import { useT } from '@/lib/i18n';
import { supabase } from '@/integrations/supabase/client';
import { fmtU } from '@/lib/tracker-helpers';
import { DEAL_TYPE_CONFIGS } from '@/lib/deal-engine';
import { toast } from 'sonner';
import { UnifiedChatInbox } from '@/features/merchants/components/UnifiedChatInbox';
import { AgreementsGlobalTab } from '@/features/merchants/components/AgreementsGlobalTab';
import { LiquidityTab } from '@/features/merchants/liquidity/LiquidityTab';
import { useSettlementOverview } from '@/hooks/useSettlementOverview';
import { useProfitShareAgreements } from '@/hooks/useProfitShareAgreements';
import { isAgreementActive, getAgreementLabel } from '@/lib/deal-engine';
import { useIsMobile } from '@/hooks/use-mobile';
import '@/styles/tracker.css';
import { focusElementBySelectors } from '@/lib/focus-target';

type MerchantTab = 'relationships' | 'agreements' | 'settlements' | 'chat' | 'liquidity';

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
  settlement_cadence?: string;
}

interface MerchantsPageProps {
  adminUserId?: string;
  adminMerchantId?: string;
  isAdminView?: boolean;
}

export default function MerchantsPage({ adminUserId, adminMerchantId, isAdminView }: MerchantsPageProps = {}) {
  const { settings } = useTheme();
  const { userId: authUserId, merchantProfile: authMerchantProfile } = useAuth();
  const effectiveUserId = adminUserId || authUserId;
  const effectiveMerchantProfile = adminMerchantId
    ? { ...authMerchantProfile, merchant_id: adminMerchantId } as typeof authMerchantProfile
    : authMerchantProfile;
  // Alias for rest of file
  const userId = effectiveUserId;
  const merchantProfile = effectiveMerchantProfile;
  const t = useT();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [searchParams] = useSearchParams();

  const [tab, setTab] = useState<MerchantTab>(() => {
    const qTab = searchParams.get('tab');
    if (qTab === 'chat' || qTab === 'settlements' || qTab === 'relationships' || qTab === 'agreements' || qTab === 'liquidity') return qTab as MerchantTab;
    return 'relationships';
  });
  const [relationships, setRelationships] = useState<any[]>([]);
  const [agreements, setAgreements] = useState<AgreementRow[]>([]);
  const [invites, setInvites] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // Find a Merchant state
  const [findQuery, setFindQuery] = useState('');
  const [findResult, setFindResult] = useState<any>(null);
  const [findStatus, setFindStatus] = useState<'idle' | 'searching' | 'found' | 'not_found' | 'already_connected'>('idle');
  const [sendingInvite, setSendingInvite] = useState(false);
  const [inviteMessage, setInviteMessage] = useState('');
  const { data: settlementOverview } = useSettlementOverview();
  const { data: allAgreements = [] } = useProfitShareAgreements();
  const [unreadChatCount, setUnreadChatCount] = useState(0);

  useEffect(() => { loadData(); }, [userId, merchantProfile?.merchant_id]);

  useEffect(() => {
    const focusInviteId = searchParams.get('focusInviteId');
    if (!focusInviteId) return;
    setTab('relationships');
    window.setTimeout(() => {
      focusElementBySelectors([
        `#invite-${focusInviteId}`,
        `[data-invite-id="${focusInviteId}"]`,
      ]);
    }, 200);
  }, [searchParams, invites.length]);


  // Fetch unread message count (scoped to this merchant's relationships only)
  useEffect(() => {
    if (!userId) return;
    const relationshipIds = relationships.map((r) => r.id).filter(Boolean);
    if (!relationshipIds.length) {
      setUnreadChatCount(0);
      return;
    }

    supabase
      .from('merchant_messages')
      .select('id', { count: 'exact', head: true })
      .in('relationship_id', relationshipIds)
      .neq('sender_id', userId)
      .is('read_at', null)
      .then(({ count }) => setUnreadChatCount(count || 0));
  }, [userId, relationships]);

  const handleOpenRelationship = useCallback((relationshipId: string) => {
    navigate(`/merchants/${relationshipId}`);
  }, [navigate]);

  const handleOpenOrders = useCallback((relationshipId: string) => {
    navigate(`/trading/orders?relationship=${relationshipId}`);
  }, [navigate]);

  const handleOpenRelationshipChat = useCallback((relationshipId: string) => {
    navigate(`/trading/merchants?tab=chat&relationship=${relationshipId}`);
  }, [navigate]);

  const loadData = async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const myMerchantId = merchantProfile?.merchant_id;

      // ── CRITICAL: filter to only THIS merchant's data ──────────────────────
      // Without these filters every merchant sees ALL other merchants' relationships,
      // invites, and deals — causing ghost connections and data leakage.
      const [relsRes, invitesRes, profilesRes] = await Promise.all([
        supabase.from('merchant_relationships').select('*')
          .or(`merchant_a_id.eq.${myMerchantId},merchant_b_id.eq.${myMerchantId}`)
          .order('created_at', { ascending: false }),
        supabase.from('merchant_invites').select('*')
          .or(`from_merchant_id.eq.${myMerchantId},to_merchant_id.eq.${myMerchantId}`)
          .order('created_at', { ascending: false }),
        supabase.from('merchant_profiles').select('merchant_id, display_name, nickname, merchant_code'),
      ]);

      const profileMap = new Map(
        (profilesRes.data || []).map(p => [p.merchant_id, p])
      );

      const enrichedRels = (relsRes.data || []).map(r => {
        const cpId = r.merchant_a_id === myMerchantId ? r.merchant_b_id : r.merchant_a_id;
        const cp = profileMap.get(cpId);
        return {
          ...r,
          counterparty_name: cp?.display_name || cpId,
          counterparty_nickname: cp?.nickname || '',
          counterparty_code: (cp as any)?.merchant_code || '',
        };
      });

      const relationshipIds = enrichedRels.map((r) => r.id);
      const dealsRes = relationshipIds.length
        ? await supabase.from('merchant_deals').select('*').in('relationship_id', relationshipIds).order('created_at', { ascending: false })
        : { data: [], error: null };
      if (dealsRes.error) throw dealsRes.error;

      const enrichedDeals: AgreementRow[] = (dealsRes.data || []).map(d => {
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
          order_count: 0,
          settlement_cadence: (d as any).settlement_cadence || 'monthly',
        };
      });

      const enrichedInvites = (invitesRes.data || []).map(inv => {
        const fromP = profileMap.get(inv.from_merchant_id);
        const toP = profileMap.get(inv.to_merchant_id);
        const isIncoming = inv.to_merchant_id === myMerchantId;
        return {
          ...inv,
          from_name: fromP?.display_name || inv.from_merchant_id,
          to_name: toP?.display_name || inv.to_merchant_id,
          is_incoming: isIncoming,
        };
      });

      setRelationships(enrichedRels);
      setAgreements(enrichedDeals);
      setInvites(enrichedInvites);
    } catch (err) {
      console.error('Failed to load merchant data:', err);
    } finally {
      setLoading(false);
    }
  };

  // ─── Find a Merchant ───
  const handleFind = async () => {
    const q = findQuery.trim();
    if (!q) return;
    setFindStatus('searching');
    setFindResult(null);
    try {
      const myMerchantId = merchantProfile?.merchant_id;
      const { data, error } = await supabase
        .from('merchant_profiles')
        .select('merchant_id, display_name, nickname, region, bio, default_currency, merchant_code, created_at')
        .or(`merchant_code.eq.${q},nickname.ilike.%${q}%,merchant_id.ilike.%${q}%`)
        .neq('merchant_id', myMerchantId || '')
        .eq('status', 'active')
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      if (!data) { setFindStatus('not_found'); return; }

      const existingMerchantIds = new Set([
        ...relationships.map(r => r.merchant_a_id === merchantProfile?.merchant_id ? r.merchant_b_id : r.merchant_a_id),
        ...invites.filter(i => i.status === 'pending').map(i =>
          i.from_merchant_id === merchantProfile?.merchant_id ? i.to_merchant_id : i.from_merchant_id
        ),
      ]);

      if (existingMerchantIds.has(data.merchant_id)) {
        setFindResult(data);
        setFindStatus('already_connected');
        return;
      }
      setFindResult(data);
      setFindStatus('found');
    } catch (err) {
      console.error('Find error:', err);
      setFindStatus('not_found');
    }
  };

  const handleSendInvite = async () => {
    if (!findResult || !merchantProfile) return;
    setSendingInvite(true);
    try {
      const { error } = await supabase.from('merchant_invites').insert({
        from_merchant_id: merchantProfile.merchant_id,
        to_merchant_id: findResult.merchant_id,
        status: 'pending',
        message: inviteMessage || null,
      });
      if (error) throw error;
      toast.success(`${t('inviteSentTo') || 'Invite sent to'} ${findResult.display_name}`);
      setFindQuery(''); setFindResult(null); setFindStatus('idle'); setInviteMessage('');
      loadData();
    } catch (err: any) { toast.error(err.message || 'Failed to send invite'); }
    finally { setSendingInvite(false); }
  };

  const handleAcceptInvite = async (invite: any) => {
    try {
      const { error: relError } = await supabase.from('merchant_relationships').insert({
        merchant_a_id: invite.from_merchant_id,
        merchant_b_id: invite.to_merchant_id,
        status: 'active',
      });
      if (relError) throw relError;
      const { error: invError } = await supabase.from('merchant_invites').update({ status: 'accepted' }).eq('id', invite.id);
      if (invError) throw invError;
      toast.success(t('inviteAccepted') || 'Invite accepted — relationship created!');
      loadData();
    } catch (err: any) { toast.error(err.message); }
  };

  const handleRejectInvite = async (id: string) => {
    try {
      const { error } = await supabase.from('merchant_invites').update({ status: 'rejected' }).eq('id', id);
      if (error) throw error;
      toast.success(t('inviteRejected') || 'Invite rejected');
      loadData();
    } catch (err: any) { toast.error(err.message); }
  };

  const handleWithdrawInvite = async (id: string) => {
    try {
      const { error } = await supabase.from('merchant_invites').update({ status: 'withdrawn' }).eq('id', id);
      if (error) throw error;
      toast.success(t('inviteWithdrawn') || 'Invite withdrawn');
      loadData();
    } catch (err: any) { toast.error(err.message); }
  };

  // Filtered lists
  const filteredRels = search
    ? relationships.filter(r =>
        r.counterparty_name?.toLowerCase().includes(search.toLowerCase()) ||
        r.counterparty_nickname?.toLowerCase().includes(search.toLowerCase())
      )
    : relationships;

  const cancelledDeals = useMemo(() => agreements.filter(a => a.status === 'cancelled'), [agreements]);

  const filteredLedger = useMemo(() => {
    if (!search) return cancelledDeals;
    return cancelledDeals.filter(a =>
      a.title.toLowerCase().includes(search.toLowerCase()) ||
      a.counterparty_name?.toLowerCase().includes(search.toLowerCase())
    );
  }, [cancelledDeals, search]);

  const statusPill = (status: string) => {
    const cls = status === 'active' || status === 'approved' || status === 'accepted' ? 'good'
      : status === 'pending' ? 'warn'
      : status === 'rejected' || status === 'cancelled' || status === 'terminated' || status === 'withdrawn' ? 'bad'
      : '';
    return <span className={`pill ${cls}`}>{status}</span>;
  };

  const dealTypeLabel = (dt: string) => {
    const cfg = DEAL_TYPE_CONFIGS[dt as keyof typeof DEAL_TYPE_CONFIGS];
    return cfg ? `${cfg.icon} ${cfg.label}` : dt;
  };

  const inboxCount = invites.filter(i => i.status === 'pending' && i.is_incoming).length;

  const overdueCount = settlementOverview?.overdueCount || 0;
  const activeAgreementCount = allAgreements.filter(a => a.status === 'approved' && isAgreementActive(a)).length;
  const tabs: { key: MerchantTab; label: string; icon: string; badge?: number }[] = [
    { key: 'relationships', label: t('relationships') || 'Relationships', icon: '👥' },
    { key: 'liquidity', label: t('liquidityTab') || 'Liquidity', icon: '💧' },
    { key: 'agreements', label: t('profitShareAgreements'), icon: '🤝' },
    { key: 'settlements', label: t('settlementTracker'), icon: '💰', badge: overdueCount > 0 ? overdueCount : undefined },
    { key: 'chat', label: t('chatTab') || 'Chat', icon: '💬', badge: unreadChatCount > 0 ? unreadChatCount : undefined },
  ];

  return (
    <div
      className="tracker-root"
      dir={t.isRTL ? 'rtl' : 'ltr'}
      style={{
        padding: isMobile ? 'max(12px, env(safe-area-inset-top, 0px)) 12px max(14px, env(safe-area-inset-bottom, 0px))' : 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        minHeight: '100%',
      }}
    >

      {/* ─── HEADER ─── */}
      <div style={{ display: 'flex', alignItems: isMobile ? 'stretch' : 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 800 }}>🏪 {t('theMerchants') || 'The Merchants'}</div>
          <div style={{ fontSize: 10, color: 'var(--muted)' }}>{t('merchantOrchestratorDesc') || 'Relationship orchestration hub'}</div>
        </div>
        <div className="inputBox" style={{ maxWidth: isMobile ? '100%' : 240, width: isMobile ? '100%' : undefined, padding: '6px 10px' }}>
          <input
            placeholder={t('search') || 'Search...'}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* ─── FIND A MERCHANT ─── */}
      <div style={{
        display: 'flex', gap: 8, alignItems: isMobile ? 'stretch' : 'center', flexWrap: isMobile ? 'wrap' : 'nowrap', padding: '8px 0',
        borderBottom: '1px solid var(--line)',
      }}>
        <div className="inputBox" style={{ flex: 1, maxWidth: isMobile ? '100%' : 320, width: isMobile ? '100%' : undefined, padding: '6px 10px' }}>
          <input
            placeholder={t('findMerchantPlaceholder') || 'Enter merchant code, nickname, or ID...'}
            value={findQuery}
            onChange={e => { setFindQuery(e.target.value); if (findStatus !== 'idle') { setFindStatus('idle'); setFindResult(null); } }}
            onKeyDown={e => { if (e.key === 'Enter') handleFind(); }}
          />
        </div>
        <button
          className="btn"
          onClick={handleFind}
          disabled={!findQuery.trim() || findStatus === 'searching'}
          style={{ whiteSpace: 'nowrap', minHeight: 44, width: isMobile ? '100%' : undefined }}
        >
          🔍 {findStatus === 'searching' ? (t('loading') || '...') : (t('findMerchant') || 'Find a Merchant')}
        </button>
      </div>

      {/* ─── FIND RESULT ─── */}
      {findStatus === 'not_found' && (
        <div style={{
          padding: '10px 14px', borderRadius: 8, border: '1px solid var(--line)',
          background: 'var(--cardBg)', fontSize: 11, color: 'var(--muted)',
        }}>
          ❌ {t('merchantNotFound') || 'No merchant found with that code or ID. Please check and try again.'}
        </div>
      )}

      {findStatus === 'already_connected' && findResult && (
        <div style={{
          padding: '10px 14px', borderRadius: 8, border: '1px solid var(--line)',
          background: 'var(--cardBg)', fontSize: 11,
        }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>{findResult.display_name}</div>
          <div style={{ color: 'var(--muted)', fontSize: 10 }}>
            ✅ {t('alreadyConnected') || 'You are already connected or have a pending invite with this merchant.'}
          </div>
        </div>
      )}

      {findStatus === 'found' && findResult && (
        <div style={{
          padding: '12px 14px', borderRadius: 8, border: '1px solid var(--brand)',
          background: 'var(--cardBg)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 13 }}>{findResult.display_name}</div>
              <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>
                @{findResult.nickname} · {t('code') || 'Code'}: <span className="mono" style={{ fontWeight: 700 }}>{findResult.merchant_code || '—'}</span>
              </div>
              {findResult.region && <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>📍 {findResult.region}</div>}
              {findResult.bio && <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>{findResult.bio}</div>}
              <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 4 }}>
                {t('memberSince') || 'Member since'}: {new Date(findResult.created_at).toLocaleDateString()}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: isMobile ? 'stretch' : 'flex-end', width: isMobile ? '100%' : undefined }}>
              <div className="inputBox" style={{ maxWidth: isMobile ? '100%' : 220, width: isMobile ? '100%' : undefined, padding: '4px 8px' }}>
                <input
                  placeholder={t('addANote') || 'Add a note (optional)...'}
                  value={inviteMessage}
                  onChange={e => setInviteMessage(e.target.value)}
                  style={{ fontSize: 10 }}
                />
              </div>
              <button className="btn" onClick={handleSendInvite} disabled={sendingInvite} style={{ fontSize: 11, minHeight: 42 }}>
                📨 {sendingInvite ? (t('loading') || '...') : (t('sendInvite') || 'Send Invite')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── TAB BAR ─── */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--line)', marginBottom: 2, overflowX: 'auto', paddingBottom: 2 }}>
        {tabs.map(({ key, label, icon, badge }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              padding: isMobile ? '10px 14px' : '9px 18px', fontSize: 11, fontWeight: tab === key ? 700 : 500,
              color: tab === key ? 'var(--brand)' : 'var(--muted)',
              borderBottom: tab === key ? '2px solid var(--brand)' : '2px solid transparent',
              background: 'transparent', border: 'none', borderBottomStyle: 'solid', cursor: 'pointer',
              transition: 'all 0.15s', letterSpacing: '.2px',
              display: 'flex', alignItems: 'center', gap: 4,
              minHeight: 44,
              whiteSpace: 'nowrap',
            }}
          >
            {icon} {label}
            {badge != null && badge > 0 && (
              <span style={{
                fontSize: 9, fontWeight: 700, background: 'var(--bad)',
                color: '#fff', borderRadius: 10, padding: '1px 6px',
                minWidth: 16, textAlign: 'center',
              }}>
                {badge}
              </span>
            )}
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
              {/* ── PENDING INVITES SECTION (INCOMING) ── */}
              {invites.filter(i => i.status === 'pending' && i.is_incoming).length > 0 && (
                <div style={{
                  padding: '10px 12px', borderRadius: 8, marginBottom: 10,
                  border: '2px solid var(--bad)',
                  background: 'color-mix(in srgb, var(--bad) 8%, var(--cardBg))',
                  animation: 'pulse 2s infinite',
                }}>
                  <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 8, color: 'var(--bad)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    🔔 {t('pendingInvitations')}
                    <span style={{
                      fontSize: 9, fontWeight: 700, background: 'var(--bad)',
                      color: '#fff', borderRadius: 10, padding: '1px 6px',
                    }}>
                      {invites.filter(i => i.status === 'pending' && i.is_incoming).length}
                    </span>
                  </div>
                  {invites.filter(i => i.status === 'pending' && i.is_incoming).map(inv => {
                    const elapsed = Date.now() - new Date(inv.created_at).getTime();
                    const days = Math.floor(elapsed / 86400000);
                    const hours = Math.floor((elapsed % 86400000) / 3600000);
                    const timeAgo = days > 0 ? `${days}d ${hours}h ago` : hours > 0 ? `${hours}h ago` : 'Just now';
                    return (
                      <div key={inv.id} style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        padding: '10px 12px', borderRadius: 6, marginBottom: 4,
                        background: 'var(--cardBg)', border: '1px solid var(--line)',
                        flexWrap: 'wrap', gap: 8,
                      }}>
                        <div style={{ flex: 1, minWidth: 180 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                            <span style={{ fontWeight: 800, fontSize: 12 }}>{inv.from_name}</span>
                            <span style={{ fontSize: 9, color: 'var(--muted)' }}>→</span>
                            <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>You</span>
                          </div>
                          {inv.message && (
                            <div style={{ fontSize: 10, color: 'var(--t2)', marginBottom: 3, fontStyle: 'italic' }}>
                              💬 "{inv.message}"
                            </div>
                          )}
                          <div style={{ display: 'flex', gap: 10, fontSize: 9, color: 'var(--muted)', flexWrap: 'wrap' }}>
                            <span>📅 {new Date(inv.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                            <span>⏱ {timeAgo}</span>
                            <span className="pill warn" style={{ fontSize: 8, padding: '1px 6px' }}>{t('pendingStatus')}</span>
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 6, width: isMobile ? '100%' : undefined }}>
                          <button
                            className="btn"
                            onClick={() => handleAcceptInvite(inv)}
                            style={{ fontSize: 11, background: 'var(--good)', color: '#fff', border: 'none', padding: '6px 14px', borderRadius: 6, fontWeight: 700, minHeight: 40, flex: isMobile ? 1 : undefined }}
                          >
                            ✓ {t('accept')}
                          </button>
                          <button
                            className="rowBtn"
                            onClick={() => handleRejectInvite(inv.id)}
                            style={{ fontSize: 11, color: 'var(--bad)', fontWeight: 700, minHeight: 40, flex: isMobile ? 1 : undefined }}
                          >
                            ✗ {t('reject')}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* ── SENT INVITES (OUTGOING PENDING) ── */}
              {invites.filter(i => i.status === 'pending' && !i.is_incoming).length > 0 && (
                <div style={{
                  padding: '10px 12px', borderRadius: 8, marginBottom: 10,
                  border: '1px solid var(--line)', background: 'var(--cardBg)',
                }}>
                  <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 8, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    📤 {t('sentInvites')}
                    <span style={{
                      fontSize: 9, fontWeight: 600, background: 'color-mix(in srgb, var(--warn) 15%, transparent)',
                      color: 'var(--warn)', borderRadius: 10, padding: '1px 6px',
                    }}>
                      {invites.filter(i => i.status === 'pending' && !i.is_incoming).length}
                    </span>
                  </div>
                  {invites.filter(i => i.status === 'pending' && !i.is_incoming).map(inv => {
                    const elapsed = Date.now() - new Date(inv.created_at).getTime();
                    const days = Math.floor(elapsed / 86400000);
                    const hours = Math.floor((elapsed % 86400000) / 3600000);
                    const timeAgo = days > 0 ? `${days}d ${hours}h ago` : hours > 0 ? `${hours}h ago` : 'Just now';
                    const expiresAt = inv.expires_at ? new Date(inv.expires_at) : null;
                    const isExpiringSoon = expiresAt && (expiresAt.getTime() - Date.now()) < 86400000 * 3;
                    return (
                      <div key={inv.id} style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        padding: '10px 12px', borderRadius: 6, marginBottom: 4,
                        border: '1px solid var(--line)', background: 'color-mix(in srgb, var(--warn) 3%, var(--cardBg))',
                        flexWrap: 'wrap', gap: 8,
                      }}>
                        <div style={{ flex: 1, minWidth: 180 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                            <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>You</span>
                            <span style={{ fontSize: 9, color: 'var(--muted)' }}>→</span>
                            <span style={{ fontWeight: 800, fontSize: 12 }}>{inv.to_name}</span>
                          </div>
                          {inv.message && (
                            <div style={{ fontSize: 10, color: 'var(--t2)', marginBottom: 3, fontStyle: 'italic' }}>
                              💬 "{inv.message}"
                            </div>
                          )}
                          <div style={{ display: 'flex', gap: 10, fontSize: 9, color: 'var(--muted)', flexWrap: 'wrap', alignItems: 'center' }}>
                            <span>📅 {new Date(inv.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                            <span>⏱ {timeAgo}</span>
                            <span className="pill warn" style={{ fontSize: 8, padding: '1px 6px' }}>Awaiting response</span>
                            {expiresAt && (
                              <span style={{ color: isExpiringSoon ? 'var(--bad)' : 'var(--muted)', fontWeight: isExpiringSoon ? 700 : 400 }}>
                                ⏳ Expires {expiresAt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                              </span>
                            )}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 6, width: isMobile ? '100%' : undefined }}>
                          <button className="rowBtn" onClick={() => handleWithdrawInvite(inv.id)} style={{ fontSize: 10, color: 'var(--bad)', minHeight: 40, width: isMobile ? '100%' : undefined }}>
                            ↩ {t('withdraw')}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>{t('activeRelationships')}</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)' }}>{filteredRels.length} {t('merchants')}</div>
                </div>
              </div>

              {filteredRels.length === 0 ? (
                <div className="empty">
                  <div className="empty-t">{t('noRelationships')}</div>
                  <div className="empty-s">{t('sendInviteToStart')}</div>
                </div>
              ) : isMobile ? (
                <div style={{ display: 'grid', gap: 8 }}>
                  {filteredRels.map(r => {
                    const relDeals = agreements.filter(a => a.relationship_id === r.id && a.status !== 'cancelled');
                    return (
                      <div key={r.id} className="panel" style={{ padding: 10, borderRadius: 10 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 700, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.counterparty_name}</div>
                            <div style={{ fontSize: 10, color: 'var(--muted)' }}>@{r.counterparty_nickname || '—'}</div>
                            <div className="mono" style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>
                              {(t('code') || 'Code')}: {r.counterparty_code || '—'}
                            </div>
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                            {statusPill(r.status)}
                            <span style={{ fontSize: 10, color: 'var(--muted)' }}>{relDeals.length} {t('deals')}</span>
                          </div>
                        </div>
                        <div style={{ marginTop: 8, fontSize: 10, color: 'var(--muted)' }}>
                          {(t('since') || 'Since')}: {new Date(r.created_at).toLocaleDateString()}
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6, marginTop: 10 }}>
                          <button className="rowBtn" type="button" onClick={() => handleOpenRelationship(r.id)} style={{ minHeight: 40 }}>
                            {t('openWorkspaceLabel')}
                          </button>
                          <button className="rowBtn" type="button" onClick={() => handleOpenOrders(r.id)} style={{ minHeight: 40 }}>
                            {t('orders')}
                          </button>
                          <button
                            className="rowBtn"
                            type="button"
                            onClick={() => {
                              setTab('chat');
                            }}
                            style={{ minHeight: 40, gridColumn: '1 / -1' }}
                          >
                            {t('chatTab') || 'Chat'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="tableWrap">
                  <table>
                    <thead>
                      <tr>
                        <th>{t('merchant')}</th>
                        <th className="hide-mobile">{t('code')}</th>
                        <th>{t('status')}</th>
                        <th className="r hide-mobile">{t('deals')}</th>
                        <th className="hide-mobile">{t('since')}</th>
                        <th>{t('actions')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRels.map(r => {
                        const relDeals = agreements.filter(a => a.relationship_id === r.id && a.status !== 'cancelled');
                        return (
                          <tr key={r.id}>
                            <td>
                              <div style={{ fontWeight: 700, fontSize: 11 }}>{r.counterparty_name}</div>
                              <div style={{ fontSize: 9, color: 'var(--muted)' }}>@{r.counterparty_nickname}</div>
                            </td>
                            <td className="mono hide-mobile" style={{ fontSize: 10, fontWeight: 700 }}>{r.counterparty_code || '—'}</td>
                            <td>{statusPill(r.status)}</td>
                            <td className="mono r hide-mobile">{relDeals.length}</td>
                            <td className="mono hide-mobile">{new Date(r.created_at).toLocaleDateString()}</td>
                            <td>
                              <div style={{ display: 'flex', gap: 4 }}>
                                <button className="rowBtn" type="button" onClick={() => handleOpenRelationship(r.id)}>
                                  {t('openWorkspaceLabel')}
                                </button>
                                <button className="rowBtn" type="button" onClick={() => handleOpenOrders(r.id)}>
                                  {t('orders')}
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

          {tab === 'liquidity' && (
            <LiquidityTab
              onOpenRelationship={handleOpenRelationship}
              onOpenChat={handleOpenRelationshipChat}
              onOpenDeal={handleOpenOrders}
            />
          )}


          {/* ═══ AGREEMENTS TAB ═══ */}
          {tab === 'agreements' && (
            <AgreementsGlobalTab
              relationships={relationships}
              allAgreements={allAgreements}
              activeAgreementCount={activeAgreementCount}
              onOpenRelationship={handleOpenRelationship}
            />
          )}

          {/* ═══ SETTLEMENTS TAB ═══ */}
          {tab === 'settlements' && (
            <>
              {/* KPI row */}
              {settlementOverview && (
                isMobile ? (
                  <div className="panel" style={{ padding: 10, marginBottom: 10 }}>
                    <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 8 }}>{t('settlementTracker')}</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
                      <div className="panel" style={{ padding: 8 }}>
                        <div style={{ fontSize: 10, color: 'var(--muted)' }}>{t('dueNow')}</div>
                        <div className="mono" style={{ fontSize: 14, fontWeight: 800, color: settlementOverview.dueCount > 0 ? 'orange' : 'var(--muted)' }}>{settlementOverview.dueCount}</div>
                      </div>
                      <div className="panel" style={{ padding: 8 }}>
                        <div style={{ fontSize: 10, color: 'var(--muted)' }}>{t('overdueSettlement')}</div>
                        <div className="mono" style={{ fontSize: 14, fontWeight: 800, color: settlementOverview.overdueCount > 0 ? 'var(--bad)' : 'var(--muted)' }}>{settlementOverview.overdueCount}</div>
                      </div>
                      <div className="panel" style={{ padding: 8 }}>
                        <div style={{ fontSize: 10, color: 'var(--muted)' }}>{t('settledThisMonth')}</div>
                        <div className="mono" style={{ fontSize: 14, fontWeight: 800, color: 'var(--good)' }}>{settlementOverview.settledThisMonth}</div>
                      </div>
                      <div className="panel" style={{ padding: 8 }}>
                        <div style={{ fontSize: 10, color: 'var(--muted)' }}>{t('totalOutstandingLabel')}</div>
                        <div className="mono" style={{ fontSize: 13, fontWeight: 800 }}>{fmtU(settlementOverview.totalOutstanding)}</div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="kpi-band" style={{ marginBottom: 10 }}>
                    <div className="kpi-band-title">{t('settlementTracker')}</div>
                    <div className="kpi-band-cols">
                      <div>
                        <div className="kpi-period">{t('dueNow')}</div>
                        <div className="kpi-cell-val" style={{ color: settlementOverview.dueCount > 0 ? 'orange' : 'var(--muted)' }}>
                          {settlementOverview.dueCount}
                        </div>
                      </div>
                      <div>
                        <div className="kpi-period">{t('overdueSettlement')}</div>
                        <div className="kpi-cell-val" style={{ color: settlementOverview.overdueCount > 0 ? 'var(--bad)' : 'var(--muted)' }}>
                          {settlementOverview.overdueCount}
                        </div>
                      </div>
                      <div>
                        <div className="kpi-period">{t('settledThisMonth')}</div>
                        <div className="kpi-cell-val" style={{ color: 'var(--good)' }}>{settlementOverview.settledThisMonth}</div>
                      </div>
                      <div>
                        <div className="kpi-period">{t('totalOutstandingLabel')}</div>
                        <div className="kpi-cell-val">{fmtU(settlementOverview.totalOutstanding)}</div>
                      </div>
                    </div>
                  </div>
                )
              )}

              {/* Grouped by relationship */}
              {!settlementOverview || settlementOverview.items.length === 0 ? (
                <div className="empty">
                  <div className="empty-t">{t('noDeals')}</div>
                  <div className="empty-s">{t('createDealsFromWorkspace')}</div>
                </div>
              ) : (
                Array.from(settlementOverview.byRelationship.entries()).map(([relId, group]) => (
                  <div key={relId} className="panel" style={{ padding: 10, marginBottom: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: isMobile ? 'stretch' : 'center', marginBottom: 6, gap: 8, flexWrap: isMobile ? 'wrap' : 'nowrap' }}>
                      <div style={{ fontSize: 12, fontWeight: 700, minWidth: 0 }}>{group.name}</div>
                      <button className="rowBtn" onClick={() => handleOpenRelationship(relId)} style={{ fontSize: 10, minHeight: isMobile ? 40 : undefined, width: isMobile ? '100%' : undefined }}>
                        {t('openWorkspace')} →
                      </button>
                    </div>
                    {isMobile ? (
                      <div style={{ display: 'grid', gap: 8, paddingBottom: 'max(8px, env(safe-area-inset-bottom, 0px))' }}>
                        {group.items.map(item => {
                          const statusCls = item.status === 'overdue' ? 'bad' : item.status === 'due' ? 'warn' : '';
                          const cadenceLabel = item.cadence === 'per_order' ? '⚡ ' + t('perTrade') : item.cadence === 'weekly' ? '📆 ' + t('weekly') : '📅 ' + t('monthly');
                          return (
                            <div key={item.period_id} className="previewBox" style={{ padding: 10 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
                                <div style={{ fontWeight: 700, fontSize: 12, minWidth: 0 }}>{item.deal_title}</div>
                                <span className={`pill ${statusCls}`} style={{ fontSize: 10 }}>{item.status === 'overdue' ? '⚠️ ' : ''}{item.status}</span>
                              </div>
                              <div style={{ display: 'grid', gap: 4 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                                  <span className="muted">{t('period') || 'Period'}</span>
                                  <span className="mono" style={{ fontSize: 11 }}>{item.period_key}</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                                  <span className="muted">{t('settlementCadence')}</span>
                                  <span style={{ fontSize: 11 }}>{cadenceLabel}</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                                  <span className="muted">{t('partnerShare')}</span>
                                  <span className="mono" style={{ fontSize: 12, fontWeight: 700 }}>{fmtU(item.partner_amount)}</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                                  <span className="muted">{t('dueDate') || 'Due'}</span>
                                  <span className="mono" style={{ fontSize: 11 }}>{item.due_at ? new Date(item.due_at).toLocaleDateString() : '—'}</span>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="tableWrap">
                        <table>
                          <thead>
                            <tr>
                              <th>{t('title') || 'Deal'}</th>
                              <th>{t('period') || 'Period'}</th>
                              <th>{t('settlementCadence')}</th>
                              <th className="r">{t('partnerShare')}</th>
                              <th>{t('status')}</th>
                              <th>{t('dueDate') || 'Due'}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {group.items.map(item => {
                              const statusCls = item.status === 'overdue' ? 'bad' : item.status === 'due' ? 'warn' : '';
                              return (
                                <tr key={item.period_id}>
                                  <td style={{ fontWeight: 700, fontSize: 11 }}>{item.deal_title}</td>
                                  <td className="mono" style={{ fontSize: 10 }}>{item.period_key}</td>
                                  <td style={{ fontSize: 10 }}>
                                    {item.cadence === 'per_order' ? '⚡ ' + t('perTrade') : item.cadence === 'weekly' ? '📆 ' + t('weekly') : '📅 ' + t('monthly')}
                                  </td>
                                  <td className="mono r">{fmtU(item.partner_amount)}</td>
                                  <td><span className={`pill ${statusCls}`}>{item.status === 'overdue' ? '⚠️ ' : ''}{item.status}</span></td>
                                  <td className="mono" style={{ fontSize: 10 }}>{item.due_at ? new Date(item.due_at).toLocaleDateString() : '—'}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                ))
              )}
            </>
          )}

          {/* ═══ CHAT TAB ═══ */}
          {tab === 'chat' && (
            <UnifiedChatInbox relationships={relationships} />
          )}

        </>
      )}
    </div>
  );
}
