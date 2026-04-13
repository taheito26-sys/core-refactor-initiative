// ─── DLPWarningBanner — Phase 17: Sensitive data warning ────────────────
import { AlertTriangle, X, Shield } from 'lucide-react';
import type { SensitiveDataResult } from '../lib/privacy-engine';

interface Props {
  result: SensitiveDataResult;
  onDismiss: () => void;
  onCancel: () => void;
}

const TYPE_LABELS: Record<string, string> = {
  credit_card: 'Credit card number',
  phone: 'Phone number',
  email: 'Email address',
  ssn: 'Social Security Number',
  iban: 'IBAN/Bank account',
};

export function DLPWarningBanner({ result, onDismiss, onCancel }: Props) {
  if (!result.hasSensitiveData) return null;

  return (
    <div className="mx-3 mb-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 animate-in fade-in-0 slide-in-from-bottom-2 duration-200">
      <div className="flex items-start gap-2.5">
        <div className="h-8 w-8 rounded-full bg-amber-500/20 flex items-center justify-center shrink-0 mt-0.5">
          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold text-amber-700 dark:text-amber-300">
            Sensitive data detected
          </p>
          <p className="text-[11px] text-amber-600/80 dark:text-amber-400/80 mt-0.5">
            Your message appears to contain:
          </p>
          <ul className="mt-1.5 space-y-0.5">
            {result.detections.slice(0, 3).map((d, i) => (
              <li key={i} className="flex items-center gap-1.5 text-[10px]">
                <Shield className="h-2.5 w-2.5 text-amber-500/60 shrink-0" />
                <span className="text-amber-700 dark:text-amber-300 font-medium">
                  {TYPE_LABELS[d.type] ?? d.type}
                </span>
                <span className="text-amber-600/50 dark:text-amber-400/50 font-mono truncate">
                  {d.masked}
                </span>
              </li>
            ))}
            {result.detections.length > 3 && (
              <li className="text-[10px] text-amber-600/50 dark:text-amber-400/50 ml-4">
                +{result.detections.length - 3} more
              </li>
            )}
          </ul>
          <div className="flex gap-2 mt-2">
            <button
              onClick={onDismiss}
              className="px-3 py-1 rounded-lg text-[10px] font-bold bg-amber-500/20 text-amber-700 dark:text-amber-300 hover:bg-amber-500/30 transition-colors"
            >
              Send anyway
            </button>
            <button
              onClick={onCancel}
              className="px-3 py-1 rounded-lg text-[10px] font-bold text-muted-foreground hover:bg-muted transition-colors"
            >
              Edit message
            </button>
          </div>
        </div>
        <button onClick={onCancel} className="text-muted-foreground/50 hover:text-muted-foreground shrink-0">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
