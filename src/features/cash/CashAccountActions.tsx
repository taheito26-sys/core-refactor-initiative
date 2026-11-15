import { useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, ArrowLeftRight, BookOpen, FileText, NotebookPen, Pencil, Settings2, Trash2, RotateCcw, HandCoins } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { useT } from '@/lib/i18n';
import { fmtTotal, type CashAccount } from '@/lib/tracker-helpers';
import type { CashAccountAction } from './CashOverview';

export function CashAccountActions({ account, balance, canTransfer, onAction, onStatement }: {
  account: CashAccount;
  balance: number;
  canTransfer: boolean;
  onAction: (account: CashAccount, action: CashAccountAction) => void;
  onStatement: (account: CashAccount) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const custody = account.type === 'merchant_custody';
  const active = account.status === 'active';
  const add = () => onAction(account, custody ? 'funding' : 'deposit');
  const remove = () => onAction(account, custody ? 'proceeds' : 'withdrawal');
  const actions = [
    { label: t('cmViewLedger'), Icon: BookOpen, run: () => onAction(account, 'ledger') },
    ...(active ? [
      { label: t('cmAddCash'), Icon: ArrowDownLeft, run: add },
      { label: custody ? t('saleProceeds') : t('cmRemoveCash'), Icon: ArrowUpRight, run: remove },
      { label: t('transferLbl'), Icon: ArrowLeftRight, run: () => onAction(account, 'transfer'), disabled: !canTransfer },
      ...(custody ? [{ label: t('settleBack'), Icon: HandCoins, run: () => onAction(account, 'settlement') }] : []),
      { label: t('notesDetailsBtn'), Icon: NotebookPen, run: () => onAction(account, 'notes') },
    ] : []),
    { label: t('edit'), Icon: Pencil, run: () => onAction(account, 'edit') },
    { label: t('cmStatement'), Icon: FileText, run: () => onStatement(account) },
  ];
  const select = (run: () => void) => { setOpen(false); run(); };
  return <>
    <div className="cm-touch-actions" aria-label={account.name}>
      {active && <><button type="button" className="cm-touch-add" onClick={add}><ArrowDownLeft size={18} />{t('cmAddCash')}</button><button type="button" className="cm-touch-remove" onClick={remove}><ArrowUpRight size={18} />{custody ? t('saleProceeds') : t('cmRemoveCash')}</button></>}
      <button type="button" className="cm-touch-manage" aria-label={`${t('cmManageAccount')} · ${account.name}`} onClick={() => setOpen(true)}><Settings2 size={18} />{t('cmManageAccount')}</button>
    </div>
    <Sheet open={open} onOpenChange={setOpen}><SheetContent side="bottom" className="tracker-root cm-account-sheet" dir={t.isRTL ? 'rtl' : 'ltr'}>
      <SheetHeader><SheetTitle>{account.name}</SheetTitle><SheetDescription>{fmtTotal(balance)} {account.currency} · {t('cmManageAccount')}</SheetDescription></SheetHeader>
      <div className="cm-sheet-actions">{actions.map(({ label, Icon, run, disabled }) => <button type="button" key={label} disabled={disabled} onClick={() => select(run)}><Icon size={21} /><span>{label}</span></button>)}</div>
      <div className="cm-sheet-danger"><button type="button" onClick={() => select(() => onAction(account, 'clear'))}><RotateCcw size={19} />{t('clearLedger')}</button><button type="button" onClick={() => select(() => onAction(account, 'delete'))}><Trash2 size={19} />{t('deleteAccountBtn')}</button></div>
    </SheetContent></Sheet>
  </>;
}
