import { CheckCircle2, Loader2 } from 'lucide-react';
import { useT } from '@/lib/i18n';

export type UpdatePhase = 'updating' | 'saving' | 'complete';

/** Status only: updates never require a user decision or button press. */
export function UpdateCard({ phase }: { phase: UpdatePhase }) {
  const t = useT();
  const complete = phase === 'complete';
  const title = complete ? 'appUpdateComplete' : phase === 'saving' ? 'appUpdateSaving' : 'appUpdateAutomatic';
  const description = complete ? 'appUpdateActive' : phase === 'saving' ? 'appUpdateSavingDescription' : 'appUpdateReopening';
  return (
    <section dir={t.isRTL ? 'rtl' : 'ltr'} aria-label={t(title)} className="w-full rounded-2xl border border-border bg-background p-4 text-foreground shadow-xl">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          {complete ? <CheckCircle2 aria-hidden="true" className="h-5 w-5" /> : <Loader2 aria-hidden="true" className="h-5 w-5 animate-spin" />}
        </span>
        <div className="min-w-0" role="status" aria-live="polite">
          <p className="text-base font-semibold">{t(title)}</p>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{t(description)}</p>
        </div>
      </div>
    </section>
  );
}
