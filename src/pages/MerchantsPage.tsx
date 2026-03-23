import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '@/lib/theme-context';
import { useAuth } from '@/features/auth/auth-context';
import { useT } from '@/lib/i18n';
import { supabase } from '@/integrations/supabase/client';
import { fmtU } from '@/lib/tracker-helpers';
import { DEAL_TYPE_CONFIGS } from '@/lib/deal-engine';
import { toast } from 'sonner';
import { RelationshipDrawer } from '@/features/merchants/components/RelationshipDrawer';
import { useSettlementOverview } from '@/hooks/useSettlementOverview';
import '@/styles/tracker.css';

type MerchantTab = 'relationships' | 'inbox' | 'settlements';

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
  const navigate = useNavigate();

  const [tab, setTab] = useState<MerchantTab>('relationships');
  const [activeRelId, setActiveRelId] = useState<string | null>(null);
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

  useEffect(() => { loadData(); }, [userId, merchantProfile?.merchant_id]);

  const handleOpenRelationship = useCallback((relationshipId: string) => {
    setActiveRelId(relationshipId);
  }, []);

  const handleOpenOrders = useCallback((relationshipId: string) => {
    navigate(`/trading/orders?relationship=${relationshipId}`);
  }, [navigate]);

  const loadData = async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const myMerchantId = merchantProfile?.merchant_id;

      const [relsRes, dealsRes, invitesRes, profilesRes] = await Promise.all([
        supabase.from('merchant_relationships').select('*').order('created_at', { ascending: false }),
        supabase.from('merchant_deals').select('*').order('created_at', { ascending: false }),
        supabase.from('merchant_invites').select('*').order('created_at', { ascending: false }),
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
  const activeRelationship = useMemo(
    () => relationships.find(r => r.id === activeRelId) ?? null,
    [relationships, activeRelId]
  );

  const tabs: { key: MerchantTab; label: string; icon: string; badge?: number }[] = [
    { key: 'relationships', label: t('relationships') || 'Relationships', icon: '👥' },
    { key: 'inbox', label: t('inbox') || 'Inbox', icon: '📥', badge: inboxCount },
    { key: 'ledger', label: t('ledger') || 'Ledger', icon: '📒' },
    
  ];

  return (
    <div className="tracker-root" dir={t.isRTL ? 'rtl' : 'ltr'} style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10, minHeight: '100%' }}>

      {/* ─── HEADER ─── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 800 }}>🏪 {t('theMerchants') || 'The Merchants'}</div>
          <div style={{ fontSize: 10, color: 'var(--muted)' }}>{t('merchantOrchestratorDesc') || 'Relationship orchestration hub'}</div>
        </div>
        <div className="inputBox" style={{ maxWidth: 240, padding: '6px 10px' }}>
          <input
            placeholder={t('search') || 'Search...'}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* ─── FIND A MERCHANT ─── */}
      <div style={{
        display: 'flex', gap: 8, alignItems: 'center', padding: '8px 0',
        borderBottom: '1px solid var(--line)',
      }}>
        <div className="inputBox" style={{ flex: 1, maxWidth: 320, padding: '6px 10px' }}>
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
          style={{ whiteSpace: 'nowrap' }}
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
              <div className="inputBox" style={{ maxWidth: 220, padding: '4px 8px' }}>
                <input
                  placeholder={t('addANote') || 'Add a note (optional)...'}
                  value={inviteMessage}
                  onChange={e => setInviteMessage(e.target.value)}
                  style={{ fontSize: 10 }}
                />
              </div>
              <button className="btn" onClick={handleSendInvite} disabled={sendingInvite} style={{ fontSize: 11 }}>
                📨 {sendingInvite ? (t('loading') || '...') : (t('sendInvite') || 'Send Invite')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── TAB BAR ─── */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--line)', marginBottom: 2 }}>
        {tabs.map(({ key, label, icon, badge }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              padding: '9px 18px', fontSize: 11, fontWeight: tab === key ? 700 : 500,
              color: tab === key ? 'var(--brand)' : 'var(--muted)',
              borderBottom: tab === key ? '2px solid var(--brand)' : '2px solid transparent',
              background: 'transparent', border: 'none', borderBottomStyle: 'solid', cursor: 'pointer',
              transition: 'all 0.15s', letterSpacing: '.2px',
              display: 'flex', alignItems: 'center', gap: 4,
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
                        <th>{t('code') || 'Code'}</th>
                        <th>{t('status')}</th>
                        <th className="r">{t('deals') || 'Deals'}</th>
                        <th>{t('since') || 'Since'}</th>
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
                            <td className="mono" style={{ fontSize: 10, fontWeight: 700 }}>{r.counterparty_code || '—'}</td>
                            <td>{statusPill(r.status)}</td>
                            <td className="mono r">{relDeals.length}</td>
                            <td className="mono">{new Date(r.created_at).toLocaleDateString()}</td>
                            <td>
                              <div style={{ display: 'flex', gap: 4 }}>
                                 <button className="rowBtn" type="button" onClick={() => handleOpenRelationship(r.id)}>
                                  Open
                                </button>
                                 <button className="rowBtn" type="button" onClick={() => handleOpenOrders(r.id)}>
                                  {t('orders') || 'Orders'}
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

          {/* ═══ INBOX TAB ═══ */}
          {tab === 'inbox' && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>{t('inbox') || 'Inbox'}</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)' }}>{t('pendingActions') || 'Pending invitations & actions'}</div>
                </div>
              </div>

              {/* Incoming invites */}
              {invites.filter(i => i.is_incoming).length === 0 ? (
                <div className="empty">
                  <div className="empty-t">{t('noInboxItems') || 'No pending items'}</div>
                  <div className="empty-s">{t('inboxEmpty') || 'Your inbox is empty'}</div>
                </div>
              ) : (
                <div className="tableWrap">
                  <table>
                    <thead>
                      <tr>
                        <th>{t('fromLabel') || 'From'}</th>
                        <th>{t('message') || 'Message'}</th>
                        <th>{t('status')}</th>
                        <th>{t('date')}</th>
                        <th>{t('actions')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invites.filter(i => i.is_incoming).map(inv => (
                        <tr key={inv.id}>
                          <td style={{ fontWeight: 700, fontSize: 11 }}>{inv.from_name}</td>
                          <td style={{ fontSize: 10, color: 'var(--muted)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {inv.message || '—'}
                          </td>
                          <td>{statusPill(inv.status)}</td>
                          <td className="mono" style={{ fontSize: 10 }}>{new Date(inv.created_at).toLocaleDateString()}</td>
                          <td>
                            {inv.status === 'pending' && (
                              <div style={{ display: 'flex', gap: 4 }}>
                                <button className="rowBtn" onClick={() => handleAcceptInvite(inv)}>✓ {t('accept') || 'Accept'}</button>
                                <button className="rowBtn" onClick={() => handleRejectInvite(inv.id)}>✗ {t('reject') || 'Reject'}</button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Sent invites */}
              {invites.filter(i => !i.is_incoming).length > 0 && (
                <>
                  <div style={{ fontSize: 11, fontWeight: 700, marginTop: 12, marginBottom: 4 }}>
                    📤 {t('sentInvites') || 'Sent Invitations'}
                  </div>
                  <div className="tableWrap">
                    <table>
                      <thead>
                        <tr>
                          <th>{t('toLabel') || 'To'}</th>
                          <th>{t('message') || 'Message'}</th>
                          <th>{t('status')}</th>
                          <th>{t('date')}</th>
                          <th>{t('actions')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {invites.filter(i => !i.is_incoming).map(inv => (
                          <tr key={inv.id}>
                            <td style={{ fontWeight: 700, fontSize: 11 }}>{inv.to_name}</td>
                            <td style={{ fontSize: 10, color: 'var(--muted)' }}>{inv.message || '—'}</td>
                            <td>{statusPill(inv.status)}</td>
                            <td className="mono" style={{ fontSize: 10 }}>{new Date(inv.created_at).toLocaleDateString()}</td>
                            <td>
                              {inv.status === 'pending' && (
                                <button className="rowBtn" onClick={() => handleWithdrawInvite(inv.id)}>↩ {t('withdraw') || 'Withdraw'}</button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </>
          )}

          {/* ═══ LEDGER TAB ═══ */}
          {tab === 'ledger' && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>📒 {t('cancelledDeals')}</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)' }}>{t('cancelledDealsDesc')}</div>
                </div>
                <span className="pill">{filteredLedger.length}</span>
              </div>

              {filteredLedger.length === 0 ? (
                <div className="empty">
                  <div className="empty-t">{t('noCancelledDeals')}</div>
                  <div className="empty-s">{t('ledgerClean')}</div>
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
                        <th>{t('cancelledOn')}</th>
                        <th>{t('date')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredLedger.map(a => (
                        <tr key={a.id} style={{ opacity: 0.7 }}>
                          <td style={{ fontWeight: 700, fontSize: 11 }}>{a.title}</td>
                          <td style={{ fontSize: 10 }}>{a.counterparty_name}</td>
                          <td style={{ fontSize: 10 }}>{dealTypeLabel(a.deal_type)}</td>
                          <td className="mono r">{fmtU(a.amount)} {a.currency}</td>
                          <td>{statusPill(a.status)}</td>
                          <td className="mono" style={{ fontSize: 10 }}>{new Date(a.created_at).toLocaleDateString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

        </>
      )}

      {/* ─── RELATIONSHIP DRAWER ─── */}
      {activeRelationship && (
        <RelationshipDrawer
          relationship={activeRelationship}
          agreements={agreements}
          onClose={() => setActiveRelId(null)}
        />
      )}
    </div>
  );
}
