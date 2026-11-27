import { Eye, EyeOff } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { useHiddenNetProfit } from './hide-net-profit';

/**
 * The eye button that hides or shows every net profit figure in the tracker. It is one shared setting: tapping it
 * on any card flips all of them, and the choice stays until it is tapped again.
 */
export function NetProfitToggle({ className }: { className?: string }) {
  const t = useT();
  const [hidden, toggle] = useHiddenNetProfit();
  const label = hidden ? t('dhShowNetProfit') : t('dhHideNetProfit');
  return (
    <button
      type="button"
      className={cn('np-eye', className)}
      aria-pressed={hidden}
      aria-label={label}
      title={label}
      onClick={e => { e.stopPropagation(); toggle(); }}
    >
      {hidden ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
    </button>
  );
}
