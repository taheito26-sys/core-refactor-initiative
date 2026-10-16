import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { WatchedMerchant } from './merchant-watch';

/**
 * Edits how a followed merchant is named: the user's own name, shown everywhere
 * instead of the Binance nickname, and any other names the merchant goes by.
 * The Binance nickname itself is never changed.
 */
export function MerchantNameEditor({ merchant, lang, busy, onSave, onCancel }: {
  merchant: WatchedMerchant; lang: 'en' | 'ar'; busy: boolean;
  onSave: (alias: string, aka: string[]) => void; onCancel: () => void;
}) {
  const L = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const [alias, setAlias] = useState(merchant.alias ?? '');
  const [aka, setAka] = useState((merchant.aka ?? []).join(', '));
  const save = () => onSave(alias, aka.split(/[,،\n]/).map(a => a.trim()).filter(Boolean));
  return (
    <div className="space-y-2 rounded-lg border border-primary/40 bg-primary/5 p-2.5">
      <div className="text-[11px] text-muted-foreground">
        {L('Binance name', 'الاسم في Binance')}: <span className="font-semibold text-foreground" dir="ltr">{merchant.nick}</span>
      </div>
      <label className="block space-y-1">
        <span className="text-[11px] font-semibold">{L('My name for him', 'اسمي له')}</span>
        <Input value={alias} onChange={e => setAlias(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') save(); }}
          placeholder={merchant.nick} className="h-8 text-xs" />
      </label>
      <label className="block space-y-1">
        <span className="text-[11px] font-semibold">{L('Other names / nicknames (separate with commas)', 'أسماء أخرى / ألقاب (افصل بينها بفاصلة)')}</span>
        <Input value={aka} onChange={e => setAka(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') save(); }} className="h-8 text-xs" />
      </label>
      <div className="flex justify-end gap-1.5">
        <Button size="sm" variant="outline" onClick={onCancel} disabled={busy}>{L('Cancel', 'إلغاء')}</Button>
        <Button size="sm" onClick={save} disabled={busy}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : L('Save', 'حفظ')}
        </Button>
      </div>
    </div>
  );
}
