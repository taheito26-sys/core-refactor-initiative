import { useMemo, useRef, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, CheckCircle2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useT } from '@/lib/i18n';
import { fmtTotal, uid, type TrackerState } from '@/lib/tracker-helpers';
import type { PendingExchangeItem } from '@/features/exchanges/reconcile';
import { canonicalMerchantName, loanSourceCanSplit, merchantNet, pendingItemToLoanSource, planLoanMove } from '../loan-ledger';
import { recordMerchantMovement } from '../usdt-workspace-model';
import { useLoanMerchantNames } from '../hooks/useLoanMerchantNames';
import { useBorrowLendCommit } from '../hooks/useBorrowLendCommit';
import { getUsdtTransferBalances } from '@/lib/usdt-transfers';

export interface MovementDraft { direction: 'in' | 'out'; name?: string; relationshipId?: string; amount?: number; item?: PendingExchangeItem }
const localInput = (ts: number) => new Date(ts - new Date(ts).getTimezoneOffset() * 60000).toISOString().slice(0, 16);

export function MerchantMovementComposer({ draft, state, pending, available, applyStateAndCommit, onClose }: {
  draft: MovementDraft; state: TrackerState; pending: PendingExchangeItem[]; available: number;
  applyStateAndCommit: (next: TrackerState) => Promise<void>; onClose: () => void;
}) {
  const t = useT(); const L = (en: string, ar: string) => t.lang === 'ar' ? ar : en;
  const merchants = useLoanMerchantNames(state);
  const { busy, commit } = useBorrowLendCommit(applyStateAndCommit);
  const [direction, setDirection] = useState(draft.direction);
  const [name, setName] = useState(draft.name ?? '');
  const [amount, setAmount] = useState(String(draft.item?.pendingUSDT ?? draft.amount ?? ''));
  const [date, setDate] = useState(localInput(draft.item?.ts || Date.now()));
  const [sourceKey, setSourceKey] = useState(draft.item?.key ?? 'manual');
  const [fee, setFee] = useState('0');
  const [note, setNote] = useState(''); const [error, setError] = useState('');
  const ids = useRef<string[]>([]); const submitting = useRef(false);
  const matching = pending.filter(item => item.direction === direction && item.transfer?.kind !== 'internal');
  const selected = matching.find(item => item.key === sourceKey);
  const source = selected ? pendingItemToLoanSource(selected) : null;
  const fixedAmount = !!source && !loanSourceCanSplit(source);
  const merchant = canonicalMerchantName(name, merchants.map(row => row.name));
  const sameName = getUsdtTransferBalances(state.usdtTransfers).filter(row => row.counterpartyName.trim().toLowerCase() === merchant.toLowerCase());
  const relationshipId = draft.name === merchant ? draft.relationshipId : sameName.length === 1 ? sameName[0].relationshipId : undefined;
  const quantity = Number(amount);
  const before = merchantNet(state.usdtTransfers, merchant, relationshipId);
  const plan = useMemo(() => Number.isFinite(quantity) && quantity > 0 ? planLoanMove(before, direction, quantity) : null, [before, direction, quantity]);
  const changeSource = (key: string) => {
    setSourceKey(key); setError('');
    const item = matching.find(item => item.key === key);
    if (item) { setFee('0'); setAmount(String(item.pendingUSDT)); setDate(localInput(item.ts || Date.now())); }
  };
  const save = async () => {
    if (submitting.current) return;
    submitting.current = true; setError('');
    try {
      if (sourceKey !== 'manual' && !source) throw new Error(L('This exchange movement was already handled. Choose another source.', 'تم تسجيل حركة المنصة بالفعل. اختر مصدرًا آخر.'));
      const draftIds = new Set(ids.current);
      const base = { ...state, usdtTransfers: state.usdtTransfers?.filter(row => !draftIds.has(row.id)) };
      let index = 0;
      const newId = () => { const position = index++; return ids.current[position] ?? (ids.current[position] = uid()); };
      const result = recordMerchantMovement(base, { name: merchant, relationshipId, direction, amount: quantity, fee: direction === 'out' ? Number(fee) : 0, ts: new Date(date).getTime(), source: source ?? undefined, note }, newId);
      if (await commit(result, 'mloanSaved')) onClose();
      else setError(L('The save was not confirmed. Your entries are still here; retry after checking the error.', 'لم يتم تأكيد الحفظ. بيانات النموذج محفوظة هنا؛ أعد المحاولة بعد التحقق من الخطأ.'));
    } catch (error) { setError(error instanceof Error ? error.message : L('Could not record the transfer.', 'تعذّر تسجيل التحويل.')); }
    finally { submitting.current = false; }
  };
  const meanings: Record<string, string> = {
    lend_out: L('Temporarily with the merchant', 'سلفة لدى التاجر'),
    lend_return: L('Returned by the merchant', 'استرداد سلفة من التاجر'),
    borrow_in: L('Received temporarily; you owe the merchant', 'سلفة مستلمة؛ عليك إعادتها للتاجر'),
    borrow_repay: L('Returned to the merchant', 'إعادة السلفة للتاجر'),
  };
  return <Dialog open onOpenChange={open => !open && !busy && onClose()}>
    <DialogContent className="usdt-movement-dialog" dir={t.isRTL ? 'rtl' : 'ltr'}>
      <DialogHeader><DialogTitle>{L('Merchant USDT transfer · Sulfa', 'تحويل USDT للتجار · سلفة')}</DialogTitle></DialogHeader>
      <p className="uw-muted">{L('Temporary USDT only. No sale, cash loan, revenue or profit is created.', 'تحويل USDT مؤقت فقط. لا يُنشئ بيعًا أو قرضًا نقديًا أو إيرادًا أو ربحًا.')}</p>
      <form onSubmit={event => { event.preventDefault(); void save(); }}>
        <fieldset disabled={busy}>
          <div className="uw-direction">
            <button type="button" className={direction === 'out' ? 'selected' : ''} onClick={() => { setDirection('out'); setSourceKey('manual'); }}><ArrowUpRight size={18} />{L('I sent USDT', 'أرسلت USDT')}</button>
            <button type="button" className={direction === 'in' ? 'selected' : ''} onClick={() => { setDirection('in'); setSourceKey('manual'); setFee('0'); }}><ArrowDownLeft size={18} />{L('I received USDT', 'استلمت USDT')}</button>
          </div>
          <label className="uw-field">{L('Match an exchange movement', 'مطابقة حركة المنصة')}
            <select value={sourceKey} onChange={event => changeSource(event.target.value)}>
              <option value="manual">{L('Not in the feed yet — record manually', 'لم تظهر في المنصة بعد — تسجيل يدوي')}</option>
              {matching.map(item => <option key={item.key} value={item.key}>{item.exchange.toUpperCase()} · {fmtTotal(item.pendingUSDT)} USDT · {item.reference}</option>)}
            </select>
            <span className="uw-muted">{L('Choose its exchange reference when available to avoid recording the movement twice.', 'اختر مرجع المنصة إن توفر لتجنب تسجيل الحركة مرتين.')}</span>
          </label>
          <label className="uw-field">{L('Merchant', 'التاجر')}
            <input value={name} onChange={event => setName(event.target.value)} placeholder={L('Choose or enter merchant name', 'اختر أو أدخل اسم التاجر')} />
          </label>
          <div className="uw-suggestions">{merchants.filter(row => !name || row.name.toLowerCase().includes(name.toLowerCase())).slice(0, 5).map(row => <button type="button" key={row.name} onClick={() => setName(row.name)}>{row.name}</button>)}</div>
          <div className="uw-form-grid">
            <label className="uw-field">{L('Amount (USDT)', 'المبلغ (USDT)')}<input inputMode="decimal" value={amount} readOnly={fixedAmount && direction === 'in'} onChange={event => setAmount(event.target.value)} /></label>
            <label className="uw-field">{L('Date and time', 'التاريخ والوقت')}<input type="datetime-local" value={date} readOnly={!!source} onChange={event => setDate(event.target.value)} /></label>
          </div>
          {direction === 'out' && <label className="uw-field">{L('Network fee (USDT, optional)', 'رسوم الشبكة (USDT، اختياري)')}<input inputMode="decimal" value={fee} onChange={event => setFee(event.target.value)} /><span className="uw-muted">{L('The merchant owes only the principal. The fee leaves your stock separately.', 'المستحق على التاجر هو المبلغ فقط. الرسوم تُخصم من مخزونك بشكل منفصل.')}</span></label>}
          {selected && direction === 'out' && <p className="uw-muted">{L('Principal + fee must equal', 'المبلغ + الرسوم يجب أن يساويا')} {fmtTotal(selected.pendingUSDT)} USDT.</p>}
          <label className="uw-field">{L('Note (optional)', 'ملاحظة (اختياري)')}<input value={note} onChange={event => setNote(event.target.value)} /></label>
          {plan && merchant && <div className="uw-move-preview">
            <strong><CheckCircle2 size={16} />{L('After this transfer', 'بعد هذا التحويل')}</strong>
            {plan.parts.map(part => <p key={part.kind}>{meanings[part.kind]}: <b>{fmtTotal(part.amount)} USDT</b></p>)}
            <p>{L('Available in the tracker', 'المتاح في المتتبع')}: <b>{fmtTotal(available + (direction === 'in' ? quantity : -quantity - (Number(fee) || 0)))} USDT</b></p>
            <p>{plan.after < -1e-6 ? L('The merchant will owe you', 'سيكون لك لدى التاجر') : plan.after > 1e-6 ? L('You will owe the merchant', 'سيكون عليك للتاجر') : L('Settled with this merchant', 'تمت التسوية مع هذا التاجر')}{Math.abs(plan.after) > 1e-6 && <>: <b>{fmtTotal(Math.abs(plan.after))} USDT</b></>}</p>
          </div>}
          {error && <p className="uw-error" role="alert">{error}</p>}
          <div className="uw-form-actions"><button type="button" onClick={onClose}>{L('Cancel', 'إلغاء')}</button><button className="uw-primary" type="submit">{busy ? L('Saving…', 'جارٍ الحفظ…') : L('Record USDT transfer', 'تسجيل تحويل USDT')}</button></div>
        </fieldset>
      </form>
    </DialogContent>
  </Dialog>;
}
