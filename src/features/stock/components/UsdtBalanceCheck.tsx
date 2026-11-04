import { useState, type ComponentProps } from 'react';
import { Scale } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useT } from '@/lib/i18n';
import { UsdtBalanceWorkspace } from './UsdtBalanceWorkspace';
import '@/styles/usdt-workspace.css';

/** Balance checks are always opt-in; opening the Stock page never opens this dialog. */
export function UsdtBalanceCheck(props: ComponentProps<typeof UsdtBalanceWorkspace>) {
  const [open, setOpen] = useState(false);
  const t = useT();
  const label = t.lang === 'ar' ? 'فحص الأرصدة' : 'Check balances';
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild>
      <button type="button" className="usdt-check-trigger"><Scale size={16} />{label}</button>
    </DialogTrigger>
    {open && <DialogContent className="usdt-check-dialog" dir={t.isRTL ? 'rtl' : 'ltr'}>
      <DialogHeader className="usdt-check-dialog-heading">
        <DialogTitle>{label}</DialogTitle>
        <DialogDescription>{t.lang === 'ar' ? 'قارن أرصدة المنصات مع مخزون المتتبع.' : 'Compare your exchange wallets with tracker stock.'}</DialogDescription>
      </DialogHeader>
      <UsdtBalanceWorkspace {...props}
        onReviewAll={() => { setOpen(false); props.onReviewAll(); }}
        onRecordTrade={item => { setOpen(false); props.onRecordTrade(item); }} />
    </DialogContent>}
  </Dialog>;
}
