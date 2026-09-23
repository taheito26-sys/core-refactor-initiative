import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useT } from '@/lib/i18n';
import { fmtDate, fmtTotal, num, uid, type TrackerState } from '@/lib/tracker-helpers';
import type { UsdtTransferKind } from '@/lib/usdt-transfers';
import { EXCHANGE_LABELS } from '@/features/exchanges/types';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  applyLoanMove,
  canonicalMerchantName,
  loanSourceAmount,
  loanSourceCanSplit,
  loanSourceDirection,
  loanSourceTs,
  merchantNet,
  planLoanMove,
  type LoanSource,
} from '../loan-ledger';
import { TagError, type TagResult } from '../usdt-tagging';
import { useBorrowLendCommit } from '../hooks/useBorrowLendCommit';
import { useLoanMerchantNames } from '../hooks/useLoanMerchantNames';

const nowInput = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

const KIND_ICON: Record<UsdtTransferKind, string> = { borrow_in: '⬇️', lend_return: '↪️', borrow_repay: '↩️', lend_out: '⬆️' };

/** One short line describing a record being classified. */
function describeSource(src: LoanSource, t: ReturnType<typeof useT>): string {
  const dir = loanSourceDirection(src) === 'in' ? t('mloanReceived') : t('mloanSent');
  const amt = `${fmtTotal(loanSourceAmount(src))} USDT`;
  switch (src.type) {
    case 'exchange_transfer':
      return `${dir} ${amt} · ${EXCHANGE_LABELS[src.transfer.exchange]} ${src.transfer.kind === 'pay' ? 'Pay' : 'Network'} · ${fmtDate(loanSourceTs(src))}`;
    case 'exchange_order':
      return `${dir} ${amt} · ${EXCHANGE_LABELS[src.order.exchange]} P2P #${src.order.order_number} · ${fmtDate(loanSourceTs(src))}`;
    case 'batch':
      return `${dir} ${amt} · ${t('mloanFromBatch')} · ${fmtDate(src.ts)}`;
    case 'trade':
      return `${dir} ${amt} · ${t('mloanFromOrder')} · ${fmtDate(src.ts)}`;
    case 'manual':
      return t('mloanManualEntry');
  }
}

/**
 * The single "🤝 Merchant loan" action. The merchant picks WHO the USDT
 * moved with; applyLoanMove decides whether that borrowed, repaid, lent or
 * got back USDT from the running balance, and the preview says so in plain
 * words (with the balance after) before anything is saved.
 */
export function MerchantLoanDialog({
  open,
  sources,
  presetName,
  state,
  applyStateAndCommit,
  onClose,
}: {
  open: boolean;
  /** Records being classified; a single `manual` source opens the hand-entry form. */
  sources: LoanSource[];
  presetName?: string;
  state: TrackerState;
  applyStateAndCommit: (next: TrackerState) => Promise<void>;
  onClose: () => void;
}) {
  const t = useT();
  const isMobile = useIsMobile();
  const { commit, busy } = useBorrowLendCommit(applyStateAndCommit);
  const merchants = useLoanMerchantNames(state);

  const manual = sources.length === 1 && sources[0].type === 'manual';
  const single = sources.length === 1 ? sources[0] : null;
  const canSplit = !!single && loanSourceCanSplit(single);

  const [name, setName] = useState(presetName ?? '');
  const [partial, setPartial] = useState(false);
  const [amount, setAmount] = useState('');
  const [manualDir, setManualDir] = useState<'in' | 'out'>('out');
  const [manualDate, setManualDate] = useState(nowInput());

  useEffect(() => {
    if (!open) return;
    setName(presetName ?? '');
    setPartial(false);
    setAmount(single && !manual ? String(Math.round(loanSourceAmount(single) * 100) / 100) : '');
    setManualDir('out');
    setManualDate(nowInput());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const knownNames = useMemo(() => merchants.map((m) => m.name), [merchants]);
  const finalName = canonicalMerchantName(name, knownNames);

  const suggestions = useMemo(() => {
    const q = name.trim().toLowerCase();
    const list = q ? merchants.filter((m) => m.name.toLowerCase().includes(q)) : merchants;
    return list.slice(0, 6);
  }, [merchants, name]);

  /** The concrete moves to record: [source, amount]. */
  const moves = useMemo((): { src: LoanSource; amount: number }[] => {
    if (manual) {
      const ts = new Date(manualDate).getTime();
      return [{ src: { type: 'manual', direction: manualDir, ts: Number.isFinite(ts) ? ts : Date.now() }, amount: num(amount, 0) }];
    }
    if (single && partial) return [{ src: single, amount: num(amount, 0) }];
    return sources.map((src) => ({ src, amount: loanSourceAmount(src) }));
  }, [manual, manualDate, manualDir, amount, single, partial, sources]);

  const totalAmount = moves.reduce((sum, m) => sum + m.amount, 0);
  const maxAmount = single && !manual ? loanSourceAmount(single) : Infinity;
  const amountOk = moves.every((m) => m.amount > 0) && totalAmount <= maxAmount + 1e-6;

  /** Plain-language preview: amounts per meaning, and the balance after. */
  const preview = useMemo(() => {
    if (!finalName || !amountOk) return null;
    let net = merchantNet(state.usdtTransfers, finalName);
    const byKind = new Map<UsdtTransferKind, number>();
    let stockIn = 0;
    let stockOut = 0;
    for (const m of moves) {
      const dir = loanSourceDirection(m.src);
      const plan = planLoanMove(net, dir, m.amount);
      for (const p of plan.parts) byKind.set(p.kind, (byKind.get(p.kind) || 0) + p.amount);
      if (dir === 'in') stockIn += m.amount;
      else stockOut += m.amount;
      net = plan.after;
    }
    return { byKind, after: net, stockIn, stockOut };
  }, [finalName, amountOk, moves, state.usdtTransfers]);

  const kindSentence = (kind: UsdtTransferKind, amt: number) => {
    const key = { borrow_in: 'mloanPreviewBorrow', lend_return: 'mloanPreviewReturn', borrow_repay: 'mloanPreviewRepay', lend_out: 'mloanPreviewLend' }[kind] as
      'mloanPreviewBorrow' | 'mloanPreviewReturn' | 'mloanPreviewRepay' | 'mloanPreviewLend';
    return t(key).split('{amount}').join(fmtTotal(amt)).split('{name}').join(finalName);
  };
  const balanceSentence = (net: number) => {
    if (Math.abs(net) <= 1e-6) return t('mloanBalanceSettled').split('{name}').join(finalName);
    const key = net > 0 ? 'mloanBalanceIOwe' : 'mloanBalanceOwesMe';
    return t(key).split('{name}').join(finalName).split('{amount}').join(fmtTotal(Math.abs(net)));
  };

  const confirm = async () => {
    if (!finalName) {
      toast.error(t('mloanErrName'));
      return;
    }
    if (!amountOk) {
      toast.error(t('mloanErrAmount'));
      return;
    }
    let acc: TagResult = { state };
    const dismiss = new Set<string>();
    const orderLinks: NonNullable<TagResult['orderLinks']> = [];
    try {
      for (const m of moves) {
        const r = applyLoanMove(acc.state, m.src, finalName, m.amount, uid);
        for (const d of r.dismiss || []) dismiss.add(d);
        orderLinks.push(...(r.orderLinks || []));
        acc = r;
      }
    } catch (err) {
      toast.error(err instanceof TagError && err.code === 'merchant_linked' ? t('mloanErrLinked') : t('mloanErrAmount'));
      return;
    }
    if (await commit({ state: acc.state, dismiss: Array.from(dismiss), orderLinks }, 'mloanSaved')) onClose();
  };

  const pill = (active: boolean): React.CSSProperties => ({
    padding: '6px 10px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer',
    border: `1px solid ${active ? 'var(--brand)' : 'var(--line)'}`,
    background: active ? 'color-mix(in srgb, var(--brand) 15%, transparent)' : 'transparent',
    color: active ? 'var(--brand)' : 'var(--text)',
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="tracker-root"
        dir={t.isRTL ? 'rtl' : 'ltr'}
        style={{ maxWidth: isMobile ? '96vw' : 460, width: isMobile ? '96vw' : undefined, maxHeight: '90dvh', overflowY: 'auto', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 12, padding: 16, gap: 12 }}
      >
        <DialogHeader>
          <DialogTitle style={{ fontSize: 15, fontWeight: 800 }}>🤝 {t('mloanTitle')}</DialogTitle>
        </DialogHeader>

        {!manual && (
          <div style={{ fontSize: 11, color: 'var(--muted)', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {sources.slice(0, 3).map((s, i) => <div key={i}>{describeSource(s, t)}</div>)}
            {sources.length > 3 && <div>+{sources.length - 3} {t('mloanMoreRecords')} · {fmtTotal(totalAmount)} USDT</div>}
          </div>
        )}

        {manual && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" style={pill(manualDir === 'in')} onClick={() => setManualDir('in')}>⬇️ {t('mloanIReceived')}</button>
              <button type="button" style={pill(manualDir === 'out')} onClick={() => setManualDir('out')}>⬆️ {t('mloanISent')}</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div className="inputBox"><input inputMode="decimal" placeholder="USDT" aria-label={t('mloanAmount')} value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
              <div className="inputBox"><input type="datetime-local" value={manualDate} onChange={(e) => setManualDate(e.target.value)} /></div>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 800 }}>{t('mloanWhichMerchant')}</div>
          <div className="inputBox">
            <input placeholder={t('mloanMerchantPlaceholder')} value={name} onChange={(e) => setName(e.target.value)} autoFocus={!presetName} />
          </div>
          {suggestions.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {suggestions.map((m) => (
                <button key={m.name} type="button" style={pill(m.name === finalName)} onClick={() => setName(m.name)}>
                  {m.name}
                  <span style={{ fontWeight: 500, fontSize: 10, color: m.net && m.net > 0 ? 'var(--bad)' : m.net && m.net < 0 ? 'var(--good)' : 'var(--muted)', marginInlineStart: 6 }}>
                    {m.net === undefined
                      ? (m.connected ? t('mloanConnected') : '')
                      : Math.abs(m.net) <= 1e-6
                        ? t('mloanSettledShort')
                        : m.net > 0
                          ? `${t('mloanYouOweShort')} ${fmtTotal(m.net)}`
                          : `${t('mloanOwesYouShort')} ${fmtTotal(-m.net)}`}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {canSplit && !manual && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {!partial ? (
              <button type="button" className="rowBtn" style={{ alignSelf: 'flex-start', fontSize: 11 }} onClick={() => setPartial(true)}>
                ✂️ {t('mloanOnlyPart')}
              </button>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div className="inputBox" style={{ flex: 1 }}>
                  <input inputMode="decimal" aria-label={t('mloanAmount')} value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
                </div>
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>/ {fmtTotal(maxAmount)} USDT</span>
              </div>
            )}
            {partial && <div style={{ fontSize: 10, color: 'var(--muted)' }}>{t('mloanPartHint')}</div>}
          </div>
        )}

        {preview && (
          <div style={{ border: '1px solid color-mix(in srgb, var(--brand) 35%, transparent)', background: 'color-mix(in srgb, var(--brand) 7%, transparent)', borderRadius: 10, padding: 10, display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
            {Array.from(preview.byKind.entries()).map(([kind, amt]) => (
              <div key={kind} style={{ fontWeight: 700 }}>{KIND_ICON[kind]} {kindSentence(kind, amt)}</div>
            ))}
            <div style={{ fontWeight: 800, color: preview.after > 1e-6 ? 'var(--bad)' : preview.after < -1e-6 ? 'var(--good)' : 'var(--good)' }}>
              {t('mloanAfterThis')} {balanceSentence(preview.after)}
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>
              {preview.stockIn > 0 && `${t('mloanStock')} +${fmtTotal(preview.stockIn)} · `}
              {preview.stockOut > 0 && `${t('mloanStock')} −${fmtTotal(preview.stockOut)} · `}
              {t('mloanNoProfit')}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn secondary" onClick={onClose}>{t('cancel')}</button>
          <button type="button" className="btn" disabled={busy || !preview} onClick={() => { void confirm(); }}>{t('mloanConfirm')}</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
