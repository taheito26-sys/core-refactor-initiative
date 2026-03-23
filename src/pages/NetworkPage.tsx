import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTheme } from '@/lib/theme-context';
import { useAuth } from '@/features/auth/auth-context';
import { useT } from '@/lib/i18n';
import { supabase } from '@/integrations/supabase/client';
import { fmtU } from '@/lib/tracker-helpers';
import { DEAL_TYPE_CONFIGS } from '@/lib/deal-engine';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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

  // Merchant search & invite dialog
  const [showInviteDialog, setShowInviteDialog] = useState(false);
  const [merchantSearch, setMerchantSearch] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedMerchant, setSelectedMerchant] = useState<any>(null);
  const [invitePurpose, setInvitePurpose] = useState('');
  const [inviteMessage, setInviteMessage] = useState('');
  const [sendingInvite, setSendingInvite] = useState(false);

  useEffect(() => {
    loadData();
  }, [userId]);

  useEffect(() => {
    setSearchParams({ tab }, { replace: true });
  }, [tab]);

  // Debounced merchant search
  useEffect(() => {
    if (merchantSearch.length < 2) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(() => searchMerchants(merchantSearch), 400);
    return () => clearTimeout(timer);
  }, [merchantSearch]);

  const searchMerchants = async (q: string) => {
    if (!q || q.length < 2) return;
    setSearching(true);
    try {
      const myMerchantId = merchantProfile?.merchant_id;
      const { data, error } = await supabase
        .from('merchant_profiles')
        .select('merchant_id, display_name, nickname, region, status')
        .or(`display_name.ilike.%${q}%,nickname.ilike.%${q}%,merchant_id.ilike.%${q}%`)
        .neq('merchant_id', myMerchantId || '')
        .eq('status', 'active')
        .limit(10);

      if (error) throw error;

      // Filter out merchants we already have a relationship or pending invite with
      const existingMerchantIds = new Set([
        ...relationships.map(r => r.merchant_a_id === myMerchantId ? r.merchant_b_id : r.merchant_a_id),
        ...invites.filter(i => i.status === 'pending').map(i => 
          i.from_merchant_id === myMerchantId ? i.to_merchant_id : i.from_merchant_id
        ),
      ]);

      setSearchResults((data || []).filter(m => !existingMerchantIds.has(m.merchant_id)));
    } catch (err) {
      console.error('Search error:', err);
    } finally {
      setSearching(false);
    }
  };

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
      : status === 'rejected' || status === 'cancelled' || status === 'terminated' || status === 'withdrawn' ? 'bad'
      : '';
    return <span className={`pill ${cls}`}>{status}</span>;
  };

  const dealTypeLabel = (dt: string) => {
    const cfg = DEAL_TYPE_CONFIGS[dt as keyof typeof DEAL_TYPE_CONFIGS];
    return cfg ? `${cfg.icon} ${cfg.label}` : dt;
  };

  // ─── Send Invite ───
  const handleSendInvite = async () => {
    if (!selectedMerchant || !merchantProfile) return;
    setSendingInvite(true);
    try {
      const { error } = await supabase.from('merchant_invites').insert({
        from_merchant_id: merchantProfile.merchant_id,
        to_merchant_id: selectedMerchant.merchant_id,
        status: 'pending',
        message: inviteMessage || null,
      });
      if (error) throw error;
      toast.success(`${t('inviteSentTo') || 'Invite sent to'} ${selectedMerchant.display_name}`);
      setShowInviteDialog(false);
      resetInviteForm();
      loadData();
    } catch (err: any) {
      toast.error(err.message || 'Failed to send invite');
    } finally {
      setSendingInvite(false);
    }
  };

  // ─── Accept Invite: create relationship ───
  const handleAcceptInvite = async (invite: any) => {
    try {
      // 1. Create the relationship
      const { error: relError } = await supabase.from('merchant_relationships').insert({
        merchant_a_id: invite.from_merchant_id,
        merchant_b_id: invite.to_merchant_id,
        status: 'active',
      });
      if (relError) throw relError;

      // 2. Update invite status
      const { error: invError } = await supabase
        .from('merchant_invites')
        .update({ status: 'accepted' })
        .eq('id', invite.id);
      if (invError) throw invError;

      toast.success(t('inviteAccepted') || 'Invite accepted — relationship created!');
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

  const handleWithdrawInvite = async (id: string) => {
    try {
      const { error } = await supabase
        .from('merchant_invites')
        .update({ status: 'withdrawn' })
        .eq('id', id);
      if (error) throw error;
      toast.success(t('inviteWithdrawn') || 'Invite withdrawn');
      loadData();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const resetInviteForm = () => {
    setMerchantSearch('');
    setSearchResults([]);
    setSelectedMerchant(null);
    setInvitePurpose('');
    setInviteMessage('');
  };

  const filteredRels = search
    ? relationships.filter(r => r.counterparty_name?.toLowerCase().includes(search.toLowerCase()))
    : relationships;

  const filteredDeals = search
    ? deals.filter(d => d.title?.toLowerCase().includes(search.toLowerCase()) || d.counterparty_name?.toLowerCase().includes(search.toLowerCase()))
    : deals;

  const inboxCount = invites.filter(i => i.status === 'pending' && i.is_incoming).length;

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
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <div className="inputBox" style={{ maxWidth: 200, padding: '6px 10px' }}>
            <input
              placeholder={t('search') || 'Search...'}
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <button className="btn" onClick={() => { resetInviteForm(); setShowInviteDialog(true); }}>
            + {t('invite') || 'Invite'}
          </button>
        </div>
      </div>

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
                                <button className="rowBtn" onClick={() => handleAcceptInvite(inv)}>
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
                                <button className="rowBtn" onClick={() => handleWithdrawInvite(inv.id)}>
                                  ↩ {t('withdraw') || 'Withdraw'}
                                </button>
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
        </>
      )}

      {/* ─── SEND INVITE DIALOG ─── */}
      <Dialog open={showInviteDialog} onOpenChange={(open) => { setShowInviteDialog(open); if (!open) resetInviteForm(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>📨 {t('sendInvite') || 'Send Invite'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {/* Search for merchant */}
            {!selectedMerchant ? (
              <>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">{t('findMerchant') || 'Find merchant...'}</label>
                  <input
                    className="w-full mt-1 rounded border border-input bg-background px-3 py-2 text-sm"
                    placeholder={t('findMerchant') || 'Search by name, nickname, or ID...'}
                    value={merchantSearch}
                    onChange={e => setMerchantSearch(e.target.value)}
                    autoFocus
                  />
                </div>
                {searching && (
                  <div className="text-xs text-muted-foreground">{t('loading') || 'Searching...'}</div>
                )}
                {searchResults.length > 0 && (
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">{t('searchResults') || 'Search results:'}</div>
                    <div className="space-y-1 max-h-48 overflow-auto">
                      {searchResults.map(m => (
                        <div
                          key={m.merchant_id}
                          className="flex items-center justify-between p-2 rounded border border-input hover:bg-accent cursor-pointer text-sm"
                          onClick={() => setSelectedMerchant(m)}
                        >
                          <div>
                            <div className="font-semibold text-xs">{m.display_name}</div>
                            <div className="text-[10px] text-muted-foreground">@{m.nickname} · {m.region || '—'}</div>
                          </div>
                          <span className="text-xs text-muted-foreground">{m.merchant_id}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {merchantSearch.length >= 2 && !searching && searchResults.length === 0 && (
                  <div className="text-xs text-muted-foreground">{t('noResults') || 'No merchants found'}</div>
                )}
              </>
            ) : (
              <>
                {/* Selected merchant */}
                <div className="flex items-center justify-between p-2 rounded border border-input bg-accent/30">
                  <div>
                    <div className="font-semibold text-sm">{t('sendInviteTo') || 'Send Invite to'}</div>
                    <div className="font-bold text-sm">{selectedMerchant.display_name}</div>
                    <div className="text-[10px] text-muted-foreground">@{selectedMerchant.nickname} · {selectedMerchant.merchant_id}</div>
                  </div>
                  <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setSelectedMerchant(null)}>
                    ✕
                  </button>
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground">{t('messageOptional') || 'Message (optional)'}</label>
                  <textarea
                    className="w-full mt-1 rounded border border-input bg-background px-3 py-2 text-sm resize-none"
                    rows={3}
                    value={inviteMessage}
                    onChange={e => setInviteMessage(e.target.value)}
                    placeholder={t('addANote') || 'Add a note...'}
                  />
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <button className="btn secondary" onClick={() => { setShowInviteDialog(false); resetInviteForm(); }}>
              {t('cancel') || 'Cancel'}
            </button>
            {selectedMerchant && (
              <button className="btn" onClick={handleSendInvite} disabled={sendingInvite}>
                {sendingInvite ? (t('loading') || '...') : (t('sendInvite') || 'Send Invite')}
              </button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
