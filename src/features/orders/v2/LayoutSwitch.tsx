import { useT } from '@/lib/i18n';
import '@/styles/layout-switch.css';
import type { OrdersDesign } from './design';

/** A compact New | Classic toggle placed at the top of a page that ships both layouts. */
export function LayoutSwitch({ design, onChange, className }: { design: OrdersDesign; onChange: (next: OrdersDesign) => void; className?: string }) {
  const t = useT();
  const options: Array<[OrdersDesign, string]> = [['v2', t('ov2LayoutNew')], ['classic', t('ov2LayoutClassic')]];
  return (
    <div className={`layout-switch${className ? ` ${className}` : ''}`} role="tablist" aria-label={t('ov2LayoutLabel')} dir={t.isRTL ? 'rtl' : 'ltr'}>
      {options.map(([value, label]) => (
        <button
          key={value}
          type="button"
          role="tab"
          aria-selected={design === value}
          className={design === value ? 'on' : ''}
          onClick={() => { if (design !== value) onChange(value); }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
