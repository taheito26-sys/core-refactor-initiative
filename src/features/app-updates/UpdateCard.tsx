import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { useT } from '@/lib/i18n';

export type UpdatePhase = 'updating' | 'saving' | 'complete' | 'failed';

/** Status only: updates never require a user decision or button press. */
export function UpdateCard({ phase, error }: { phase: UpdatePhase; error?: string }) {
  const t = useT();
  const complete = phase === 'complete';
  const failed = phase === 'failed';
  const title = failed ? 'appUpdateSaveFailed' : complete ? 'appUpdateComplete' : phase === 'saving' ? 'appUpdateSaving' : 'appUpdateAutomatic';
  const description = failed ? 'appUpdateSaveRetry' : complete ? 'appUpdateActive' : phase === 'saving' ? 'appUpdateSavingDescription' : 'appUpdateReopening';
  return (
    <section dir={t.isRTL ? 'rtl' : 'ltr'} aria-label={t(title)} className="w-full rounded-2xl border border-border bg-background p-4 text-foreground shadow-xl">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          {failed ? <AlertTriangle aria-hidden="true" className="h-5 w-5" /> : complete ? <CheckCircle2 aria-hidden="true" className="h-5 w-5" /> : <Loader2 aria-hidden="true" className="h-5 w-5 animate-spin" />}
        </span>
        <div className="min-w-0" role="status" aria-live="polite">
          <p className="text-base font-semibold">{t(title)}</p>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{t(description)}</p>
          {error && <p className="mt-1 text-sm text-destructive">{error}</p>}
        </div>
      </div>
    </section>
  );
}
