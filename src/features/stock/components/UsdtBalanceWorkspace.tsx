import { useEffect, useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, ArrowRight, CheckCircle2, ChevronDown, CircleHelp, Clock3, RefreshCw, Wallet } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useT } from '@/lib/i18n';
import { fmtTotal, type TrackerState } from '@/lib/tracker-helpers';
import type { ExchangeBalance } from '@/features/exchanges/types';
import type { PendingExchangeItem } from '@/features/exchanges/reconcile';
import { useExchangeCredentials } from '@/features/exchanges/hooks/useExchangeCredentials';
import { syncExchange } from '@/features/exchanges/api';
import { buildMerchantStatements } from '../loan-ledger';
import { buildUsdtWorkspace, linkManualMovement, manualMovementMatches, USDT_MATCH_TOLERANCE } from '../usdt-workspace-model';
import { MerchantMovementComposer, type MovementDraft } from './MerchantMovementComposer';
import { useBorrowLendCommit } from '../hooks/useBorrowLendCommit';
import '@/styles/usdt-workspace.css';

interface Props {
  state: TrackerState; available: number; balances?: ExchangeBalance[]; pending: PendingExchangeItem[];
  loading?: boolean; balanceError?: string; applyStateAndCommit: (next: TrackerState) => Promise<void>;
  onReviewAll: () => void; onRecordTrade: (item: PendingExchangeItem) => void;
}

export function UsdtBalanceWorkspace({ state, available, balances, pending, loading, balanceError, applyStateAndCommit, onReviewAll, onRecordTrade }: Props) {
  const t = useT(); const L = (en: string, ar: string) => t.lang === 'ar' ? ar : en;
  const { data: credentials, error: credentialsError, isPending: credentialsPending } = useExchangeCredentials();
  const connected = useMemo(() => [...new Set((credentials ?? []).map(row => row.exchange))], [credentials]);
  const model = useMemo(() => buildUsdtWorkspace(available, { usdtTransfers: state.usdtTransfers }, balances, connected), [available, state.usdtTransfers, balances, connected]);
  const [draft, setDraft] = useState<MovementDraft | null>(null);
  const [refreshing, setRefreshing] = useState(false); const [syncError, setSyncError] = useState('');
  const [verifiedAt, setVerifiedAt] = useState<Record<string, number>>({});
  const [now, setNow] = useState(Date.now);
  const [showReview, setShowReview] = useState(false);
  const { commit, busy } = useBorrowLendCommit(applyStateAndCommit);
  const queryClient = useQueryClient();
  const statements = useMemo(() => buildMerchantStatements(state.usdtTransfers), [state.usdtTransfers]);
  useEffect(() => {
    const timer = window.setInterval(() => { if (document.visibilityState !== 'hidden') setNow(Date.now()); }, 60000);
    return () => window.clearInterval(timer);
  }, []);
  const syncTimes = connected.map(exchange => Math.max(verifiedAt[exchange] ?? 0, ...(balances ?? [])
    .filter(row => row.exchange === exchange && ['spot', 'funding'].includes(row.account_type))
    .map(row => Date.parse(row.updated_at)).filter(Number.isFinite), 0));
  const lastSync = syncTimes.length ? Math.min(...syncTimes) : 0;
  const stale = !lastSync || now - lastSync > 15 * 60000;
  const readError = syncError || balanceError || (credentialsError instanceof Error ? credentialsError.message : '')
    || credentials?.find(row => row.last_sync_error)?.last_sync_error || '';
  const verifying = refreshing || loading || credentialsPending;
  const verified = !verifying && !readError && !stale && connected.length > 0 && model.observed !== null;
  const status = verifying ? L('Checking balances…', 'جارٍ التحقق من الأرصدة…')
    : !connected.length ? L('Connect an exchange to compare', 'اربط منصة للمقارنة')
      : !verified ? L('Sync to verify', 'زامن للتحقق') : model.matched ? L('Balances match', 'الأرصدة متطابقة') : L('Difference to review', 'فرق يحتاج مراجعة');
  const tone = verified && model.matched ? 'matched' : verified ? 'review' : 'unknown';
  const refresh = async () => {
    if (refreshing || !connected.length) return;
    setRefreshing(true); setSyncError('');
    try {
      const results = await Promise.allSettled(connected.map(async exchange => {
        const result = await syncExchange(exchange, 'balances');
        if (result?.errors?.balances) throw new Error(String(result.errors.balances));
        setVerifiedAt(current => ({ ...current, [exchange]: Date.now() }));
      }));
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ['exchange-balances'] }),
        queryClient.invalidateQueries({ queryKey: ['exchange-credentials'] }),
      ]);
      const failures = results.flatMap((result, index) => result.status === 'rejected' ? [`${connected[index].toUpperCase()}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`] : []);
      if (failures.length) setSyncError(failures.join(' · '));
      setNow(Date.now());
    } catch (error) { setSyncError(error instanceof Error ? error.message : L('Could not refresh balances.', 'تعذّر تحديث الأرصدة.')); }
    finally { setRefreshing(false); }
  };
  const link = async (item: PendingExchangeItem, key: string) => {
    try { await commit(linkManualMovement(state, item, key), 'mloanSaved'); }
    catch (error) { setSyncError(error instanceof Error ? error.message : L('Could not link the movement.', 'تعذّر ربط الحركة.')); }
  };
  const openMerchants = model.merchants.filter(row => Math.abs(row.position) > 1e-6);
  return <section className="usdt-workspace" dir={t.isRTL ? 'rtl' : 'ltr'} aria-label={L('USDT balance workspace', 'مساحة أرصدة USDT')}>
    <header className="uw-heading">
      <div><span className="uw-eyebrow"><Wallet size={15} />{L('USDT, accounted for', 'USDT واضح ومحسوب')}</span><h2>{L('Your money, in the right place', 'أموالك، كل مبلغ في مكانه')}</h2><p className="uw-muted">{L('Exchange wallets, merchant advances and movements to review — in one place.', 'أرصدة المنصات وسلف التجار والحركات التي تحتاج مراجعة، في مكان واحد.')}</p></div>
      <button type="button" className="uw-sync" disabled={refreshing || !connected.length} onClick={() => { void refresh(); }}><RefreshCw size={15} className={refreshing ? 'uw-spinning' : ''} />{L('Sync balances', 'مزامنة الأرصدة')}</button>
    </header>
    <div className={`uw-status ${tone}`} role="status"><span>{verified && model.matched ? <CheckCircle2 size={19} /> : verifying ? <RefreshCw size={19} /> : <CircleHelp size={19} />}<b>{status}</b></span>{lastSync > 0 && <small><Clock3 size={12} />{L('Balance snapshot', 'لقطة الرصيد')}: {new Date(lastSync).toLocaleString(t.lang === 'ar' ? 'ar-EG' : 'en-GB', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</small>}</div>
    {readError && <p className="uw-error" role="alert">{readError}</p>}
    <div className="uw-balance-grid">
      <div className="uw-number"><span>{L('Expected on exchanges', 'المتوقع في المنصات')}</span><strong>{fmtTotal(model.expected)} <small>USDT</small></strong><p>{L('Available tracker stock · all dates', 'مخزون المتتبع المتاح · جميع التواريخ')}</p></div>
      <div className="uw-number"><span>{L('In connected exchange wallets', 'في محافظ المنصات المربوطة')}</span><strong>{model.observed === null || !connected.length ? '—' : fmtTotal(model.observed)} <small>USDT</small></strong><p>{connected.length ? connected.map(exchange => `${exchange.toUpperCase()} ${fmtTotal(model.exchanges[exchange])}`).join(' · ') : L('No connected wallet', 'لا توجد محفظة مربوطة')}</p></div>
      <div className={`uw-number uw-difference ${tone}`}><span>{L('Difference to explain', 'الفرق المطلوب تفسيره')}</span><strong>{model.difference === null || !connected.length ? '—' : fmtTotal(Math.abs(model.difference))} <small>USDT</small></strong><p>{!verified ? L('Verify the latest snapshot first', 'تحقق من أحدث رصيد أولًا') : model.matched ? L('Nothing to adjust', 'لا حاجة إلى تعديل') : model.difference! > 0 ? L('Tracker expects more than the wallets', 'المتتبع يتوقع أكثر من المحافظ') : L('Wallets hold more than the tracker', 'المحافظ تحتوي أكثر من المتتبع')}</p></div>
    </div>
    <div className="uw-ownership">
      <div><span>{L('Temporarily with merchants', 'سلف لدى التجار')}</span><strong>{fmtTotal(model.withMerchants)} USDT</strong><small>{L('Owed back to you · already outside available stock', 'ستُعاد إليك · مستبعدة بالفعل من المخزون المتاح')}</small></div>
      <div><span>{L('You owe merchants', 'سلف عليك للتجار')}</span><strong>{fmtTotal(model.borrowed)} USDT</strong><small>{L('Received USDT you need to return', 'USDT استلمته وعليك إعادته')}</small></div>
      <div><span>{L('Net USDT you own', 'صافي USDT المملوك لك')}</span><strong>{fmtTotal(model.netOwned)} USDT</strong><small>{L('Available + with merchants − owed', 'المتاح + ما لدى التجار − ما عليك')}</small></div>
    </div>
    <div className="uw-main-actions">
      <button type="button" className="uw-primary" onClick={() => setDraft({ direction: 'out' })}><ArrowUpRight size={18} />{L('Sent USDT · Sulfa', 'أرسلت USDT · سلفة')}</button>
      <button type="button" onClick={() => setDraft({ direction: 'in' })}><ArrowDownLeft size={18} />{L('Received / returned USDT', 'استلمت USDT / استرددت سلفة')}</button>
      <button type="button" onClick={() => setShowReview(value => !value)}><CircleHelp size={17} />{L('Review movements', 'مراجعة الحركات')} <b>{pending.length}</b><ChevronDown size={15} /></button>
    </div>
    {verified && !model.matched && <p className="uw-guidance">{L('A difference does not mean a batch is wrong. Check unrecorded sales, purchases, transfers and fees before changing stock.', 'وجود فرق لا يعني أن دفعة المخزون خاطئة. راجع المبيعات والمشتريات والتحويلات والرسوم غير المسجلة قبل تعديل المخزون.')}</p>}
    {showReview && <div className="uw-review-list">
      <div className="uw-section-head"><h3>{L('Choose what each movement was', 'حدد طبيعة كل حركة')}</h3><button type="button" onClick={onReviewAll}>{L('All movements & history', 'جميع الحركات والسجل')}<ArrowRight size={14} /></button></div>
      {!pending.length && <p className="uw-muted">{L('No unclassified exchange movements in the loaded feed.', 'لا توجد حركات منصة غير مصنفة في السجل المحمّل.')}</p>}
      {pending.slice(0, 6).map(item => <article key={item.key} className="uw-review-item">
        <div><b>{item.direction === 'out' ? '↗' : '↙'} {fmtTotal(item.pendingUSDT)} USDT</b><span>{item.exchange.toUpperCase()} · {item.reference}</span><small>{item.ts ? new Date(item.ts).toLocaleString() : ''}</small></div>
        <div className="uw-row-actions">{item.transfer?.kind === 'internal' ? <button type="button" onClick={() => onRecordTrade(item)}>{L('Own-wallet transfer — review wallet coverage', 'تحويل بين محافظك — راجع المحافظ المشمولة')}</button> : <><button type="button" onClick={() => setDraft({ direction: item.direction, name: item.counterparty ?? '', item })}>{L('Merchant transfer · Sulfa', 'تحويل تاجر · سلفة')}</button><button type="button" onClick={() => onRecordTrade(item)}>{item.direction === 'out' ? L('Sale', 'بيع') : L('Purchase', 'شراء')}</button></>}</div>
        {manualMovementMatches(state, item).map(match => <button type="button" className="uw-existing-match" key={match.key} disabled={busy} onClick={() => { void link(item, match.key); }}>{L('Already recorded with', 'مسجلة بالفعل مع')} {match.name} · {new Date(match.ts).toLocaleString()} — {L('Link without recording again', 'ربط دون تكرار التسجيل')}</button>)}
      </article>)}
      {pending.length > 6 && <button type="button" className="uw-show-all" onClick={onReviewAll}>{L(`Review all ${pending.length} movements`, `مراجعة جميع الحركات (${pending.length})`)}</button>}
    </div>}
    <div className="uw-merchants">
      <div className="uw-section-head"><h3>{L('USDT with merchants · Sulfa', 'USDT مع التجار · سلفة')}</h3><button type="button" onClick={onReviewAll}>{L('Full statements', 'الكشوف الكاملة')}<ArrowRight size={14} /></button></div>
      {!openMerchants.length && <p className="uw-muted">{L('No outstanding merchant advances. Sent and returned USDT will appear here.', 'لا توجد سلف تجار معلقة. ستظهر هنا التحويلات المرسلة والمستردة.')}</p>}
      {openMerchants.map(row => <article className="uw-merchant" key={row.key}>
        <div className="uw-merchant-summary"><div><b>{row.counterpartyName}</b><span>{row.position > 0 ? L('With this merchant · to be returned', 'لدى هذا التاجر · ستُعاد إليك') : L('Received from this merchant · you owe', 'مستلمة من هذا التاجر · عليك إعادتها')}</span></div><strong>{fmtTotal(Math.abs(row.position))} <small>USDT</small></strong></div>
        <div className="uw-merchant-actions"><button type="button" onClick={() => setDraft({ direction: row.position > 0 ? 'in' : 'out', name: row.counterpartyName, relationshipId: row.relationshipId, amount: Math.abs(row.position) })}>{row.position > 0 ? L('Record a return', 'تسجيل استرداد') : L('Return to merchant', 'إعادة للتاجر')}</button><details><summary>{L('Movement history', 'سجل الحركات')}</summary>{statements.find(statement => statement.key === row.key)?.lines.slice().reverse().slice(0, 10).map(line => <p key={line.id}>{new Date(line.ts).toLocaleDateString()} · {line.direction === 'in' ? '↓' : '↑'} {fmtTotal(line.amount)} USDT{line.transfer.feeUSDT ? ` · ${L('fee', 'رسوم')} ${fmtTotal(line.transfer.feeUSDT)}` : ''}</p>)}</details></div>
      </article>)}
    </div>
    <footer className="uw-footnote">{L(`Spot + funding, including locked USDT. Comparison uses all remaining stock and a ${USDT_MATCH_TOLERANCE} USDT rounding tolerance. Merchant transfers create no sales or trading profit.`, `سبوت + تمويل، بما فيه USDT المحجوز. المقارنة تشمل كل المخزون المتبقي وبهامش تقريب ${USDT_MATCH_TOLERANCE} USDT. تحويلات التجار لا تُنشئ مبيعات أو أرباح تداول.`)}</footer>
    {draft && <MerchantMovementComposer key={`${draft.direction}:${draft.name ?? ''}:${draft.item?.key ?? ''}`} draft={draft} state={state} pending={pending} available={available} applyStateAndCommit={applyStateAndCommit} onClose={() => setDraft(null)} />}
  </section>;
}
