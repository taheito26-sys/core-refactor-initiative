import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTheme } from '@/lib/theme-context';
import { useAuth } from '@/features/auth/auth-context';
import { useT } from '@/lib/i18n';
import { supabase } from '@/integrations/supabase/client';
import { fmtU } from '@/lib/tracker-helpers';
import { DEAL_TYPE_CONFIGS } from '@/lib/deal-engine';
import { toast } from 'sonner';
import '@/styles/tracker.css';

type NetworkTab = 'network' | 'deals' | 'inbox';

export default function NetworkPage() {
  const { settings } = useTheme();
  const { userId, merchantProfile } = useAuth();
  const t = useT();
  const [searchParams, setSearchParams] = useSearchParams();

  const initialTab = (searchParams.get('tab') as NetworkTab) || 'network';
  const [tab, setTab] = useState<NetworkTab>(initialTab);
  const [search, setSearch] = useState('');

  // Data
  const [relationships, setRelationships] = useState<any[]>([]);
  const [deals, setDeals] = useState<any[]>([]);
  const [invites, setInvites] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Inbox visibility
  const [inboxExpanded, setInboxExpanded] = useState(false);

  useEffect(() => {
    loadData();
  }, [userId]);

  useEffect(() => {
    setSearchParams({ tab }, { replace: true });
  }, [tab]);

  const loadData = async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const myMerchantId = merchantProfile?.merchant_id;

      const [relsRes, dealsRes, invitesRes, profilesRes] = await Promise.all([
        supabase.from('merchant_relationships').select('*').order('created_at', { ascending: false }),
        supabase.from('merchant_deals').select('*').order('created_at', { ascending: false }),
        supabase.from('merchant_invites').select('*').order('created_at', { ascending: false }),
        supabase.from('merchant_profiles').select('merchant_id, display_name, nickname'),
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
        };
      });

      const enrichedDeals = (dealsRes.data || []).map(d => {
        const rel = enrichedRels.find(r => r.id === d.relationship_id);
        return { ...d, counterparty_name: rel?.counterparty_name || '—' };
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
      setDeals(enrichedDeals);
      setInvites(enrichedInvites);
    } catch (err) {
      console.error('Network load error:', err);
    } finally {
      setLoading(false);
    }
  };

  const statusPill = (status: string) => {
    const cls = status === 'active' || status === 'approved' || status === 'accepted' ? 'good'
      : status === 'pending' ? 'warn'
      : status === 'rejected' || status === 'cancelled' || status === 'terminated' ? 'bad'
      : '';
    return <span className={`pill ${cls}`}>{status}</span>;
  };

  const dealTypeLabel = (dt: string) => {
    const cfg = DEAL_TYPE_CONFIGS[dt as keyof typeof DEAL_TYPE_CONFIGS];
    return cfg ? `${cfg.icon} ${cfg.label}` : dt;
  };

  const handleAcceptInvite = async (id: string) => {
    try {
      const { error } = await supabase
        .from('merchant_invites')
        .update({ status: 'accepted' })
        .eq('id', id);
      if (error) throw error;
      toast.success(t('inviteAccepted') || 'Invite accepted');
      loadData();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleRejectInvite = async (id: string) => {
    try {
      const { error } = await supabase
        .from('merchant_invites')
        .update({ status: 'rejected' })
        .eq('id', id);
      if (error) throw error;
      toast.success(t('inviteRejected') || 'Invite rejected');
      loadData();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const filteredRels = search
    ? relationships.filter(r => r.counterparty_name?.toLowerCase().includes(search.toLowerCase()))
    : relationships;

  const filteredDeals = search
    ? deals.filter(d => d.title?.toLowerCase().includes(search.toLowerCase()) || d.counterparty_name?.toLowerCase().includes(search.toLowerCase()))
    : deals;

  const pendingInvites = invites.filter(i => i.status === 'pending');
  const inboxCount = pendingInvites.filter(i => i.is_incoming).length;

  const tabs: { key: NetworkTab; label: string; icon: string; badge?: number }[] = [
    { key: 'network', label: t('myNetwork') || 'My Network', icon: '👥' },
    { key: 'deals', label: t('deals'), icon: '🤝' },
    { key: 'inbox', label: t('inbox') || 'Inbox', icon: '📥', badge: inboxCount },
  ];

  return (
    <div className="tracker-root" dir={t.isRTL ? 'rtl' : 'ltr'} style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10, minHeight: '100%' }}>

      {/* ─── HEADER ─── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 800 }}>🌐 {t('network')}</div>
          <div style={{ fontSize: 10, color: 'var(--muted)' }}>{t('networkDesc') || 'Relationships, deals & invitations'}</div>
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
        {tabs.map(({ key, label, icon, badge }) => (
          <button
            key={key}
            onClick={() => {
              setTab(key);
              if (key === 'inbox') setInboxExpanded(true);
            }}
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
          {/* ═══ MY NETWORK TAB ═══ */}
          {tab === 'network' && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>{t('myNetwork') || 'My Network'}</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)' }}>{filteredRels.length} {t('connections') || 'connections'}</div>
                </div>
              </div>

              {filteredRels.length === 0 ? (
                <div className="empty">
                  <div className="empty-t">{t('noConnections') || 'No connections yet'}</div>
                  <div className="empty-s">{t('sendInviteToConnect') || 'Send an invitation to connect with merchants'}</div>
                </div>
              ) : (
                <div className="tableWrap">
                  <table>
                    <thead>
                      <tr>
                        <th>{t('merchant') || 'Merchant'}</th>
                        <th>{t('status')}</th>
                        <th className="r">{t('deals')}</th>
                        <th className="r">{t('exposure') || 'Exposure'}</th>
                        <th>{t('since') || 'Since'}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRels.map(r => {
                        const relDeals = deals.filter(d => d.relationship_id === r.id);
                        const activeExp = relDeals.filter(d => d.status === 'active').reduce((s: number, d: any) => s + d.amount, 0);
                        return (
                          <tr key={r.id}>
                            <td>
                              <div style={{ fontWeight: 700, fontSize: 11 }}>{r.counterparty_name}</div>
                              <div style={{ fontSize: 9, color: 'var(--muted)' }}>@{r.counterparty_nickname}</div>
                            </td>
                            <td>{statusPill(r.status)}</td>
                            <td className="mono r">{relDeals.length}</td>
                            <td className="mono r">{fmtU(activeExp)} USDT</td>
                            <td className="mono" style={{ fontSize: 10 }}>{new Date(r.created_at).toLocaleDateString()}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {/* ═══ DEALS TAB ═══ */}
          {tab === 'deals' && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>{t('deals')}</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)' }}>{filteredDeals.length} {t('total') || 'total'}</div>
                </div>
              </div>

              {filteredDeals.length === 0 ? (
                <div className="empty">
                  <div className="empty-t">{t('noDeals') || 'No deals yet'}</div>
                  <div className="empty-s">{t('createDealFromMerchants') || 'Create deals from The Merchants page'}</div>
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
                      </tr>
                    </thead>
                    <tbody>
                      {filteredDeals.map((d: any) => (
                        <tr key={d.id}>
                          <td style={{ fontWeight: 700, fontSize: 11 }}>{d.title}</td>
                          <td style={{ fontSize: 10 }}>{d.counterparty_name}</td>
                          <td style={{ fontSize: 10 }}>{dealTypeLabel(d.deal_type)}</td>
                          <td className="mono r">{fmtU(d.amount)} {d.currency}</td>
                          <td>{statusPill(d.status)}</td>
                          <td className="mono" style={{ fontSize: 10 }}>{new Date(d.created_at).toLocaleDateString()}</td>
                        </tr>
                      ))}
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
                                <button className="rowBtn" onClick={() => handleAcceptInvite(inv.id)}>
                                  ✓ {t('accept') || 'Accept'}
                                </button>
                                <button className="rowBtn" onClick={() => handleRejectInvite(inv.id)}>
                                  ✗ {t('reject') || 'Reject'}
                                </button>
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
                        </tr>
                      </thead>
                      <tbody>
                        {invites.filter(i => !i.is_incoming).map(inv => (
                          <tr key={inv.id}>
                            <td style={{ fontWeight: 700, fontSize: 11 }}>{inv.to_name}</td>
                            <td style={{ fontSize: 10, color: 'var(--muted)' }}>{inv.message || '—'}</td>
                            <td>{statusPill(inv.status)}</td>
                            <td className="mono" style={{ fontSize: 10 }}>{new Date(inv.created_at).toLocaleDateString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
