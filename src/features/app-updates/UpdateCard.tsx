import { Download, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n';

export function UpdateCard({ updating, onUpdate, onLater }: {
  updating: boolean;
  onUpdate: () => void;
  onLater: () => void;
}) {
  const t = useT();
  return (
    <section dir={t.isRTL ? 'rtl' : 'ltr'} aria-label={t('appUpdateReady')} className="w-full rounded-2xl border border-border bg-background p-4 text-foreground shadow-xl">
      <div className="mb-4 flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          {updating ? <Loader2 aria-hidden="true" className="h-5 w-5 animate-spin" /> : <Download aria-hidden="true" className="h-5 w-5" />}
        </span>
        <div className="min-w-0" role="status" aria-live="polite">
          <p className="text-base font-semibold">{t(updating ? 'appUpdateApplying' : 'appUpdateReady')}</p>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{t(updating ? 'appUpdateReopening' : 'appUpdateSaveFirst')}</p>
        </div>
      </div>
      <Button className="h-12 w-full rounded-xl text-base font-semibold" disabled={updating} aria-busy={updating} onClick={onUpdate}>
        {updating ? <Loader2 aria-hidden="true" className="animate-spin" /> : <Download aria-hidden="true" />}
        {t(updating ? 'appUpdateApplying' : 'appUpdateNow')}
      </Button>
      {!updating && <Button variant="ghost" className="mt-1 h-11 w-full rounded-xl" onClick={onLater}>{t('appUpdateLater')}</Button>}
    </section>
  );
}
