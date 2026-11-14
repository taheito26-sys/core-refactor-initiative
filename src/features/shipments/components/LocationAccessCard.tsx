import { CheckCircle2, Loader2, MapPin, MapPinOff, Settings } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { canTrackInBackground, openLocationSettings } from '../native-tracker';
import type { Lang } from '../route';
import type { LocationAccess } from '../useLocationAccess';

/**
 * Asks the driver for location, and says what is happening with it. Location is required: every photo is
 * stamped with the position, and while a trip is on the road the position goes out about every hour.
 */
export function LocationAccessCard({ access, lang }: { access: LocationAccess; lang: Lang }) {
  const L = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const [asking, setAsking] = useState(false);
  const native = canTrackInBackground();

  if (access.permission === 'checking') return null;

  if (access.permission === 'granted') {
    return (
      <div className="space-y-1.5">
        <div className="flex items-center gap-2 rounded-xl bg-emerald-500/10 px-3 py-2 text-sm font-semibold text-emerald-700 dark:text-emerald-400" role="status">
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
          {access.activeCount > 0
            ? L('Location is on · your position is sent every hour', 'الموقع مفعّل · يُرسل موقعك كل ساعة')
            : L('Location is on', 'الموقع مفعّل')}
        </div>
        {access.backgroundDenied && native && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300" role="alert">
            <span>{L('Allow location and notifications in settings so your position keeps updating with the screen off.', 'اسمح بالموقع والإشعارات من الإعدادات ليستمر تحديث موقعك والشاشة مطفأة.')}</span>
            <Button size="sm" variant="outline" onClick={() => void openLocationSettings()}><Settings className="me-1.5 h-4 w-4" aria-hidden="true" />{L('Open settings', 'فتح الإعدادات')}</Button>
          </div>
        )}
      </div>
    );
  }

  const denied = access.permission === 'denied';
  const unsupported = access.permission === 'unsupported';
  return (
    <section className="space-y-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4" role="alert">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/20 text-amber-700 dark:text-amber-400">
          {denied || unsupported ? <MapPinOff className="h-5 w-5" aria-hidden="true" /> : <MapPin className="h-5 w-5" aria-hidden="true" />}
        </span>
        <div className="space-y-1">
          <h2 className="text-base font-bold">
            {unsupported ? L('This phone can’t share its location', 'هذا الهاتف لا يستطيع مشاركة الموقع')
              : denied ? L('Location is blocked', 'الموقع محظور')
                : L('Allow location to send readings', 'اسمح بالموقع لإرسال القراءات')}
          </h2>
          <p className="text-sm text-muted-foreground">
            {denied
              ? L('Open your phone’s settings for this app and set Location to Allow. Temperature photos cannot be sent without it.', 'افتح إعدادات الهاتف لهذا التطبيق واجعل الموقع «سماح». لا يمكن إرسال صور الحرارة بدونه.')
              : L('Every temperature photo is stamped with the time and your position, and while a trip is on the road your position is sent every hour.', 'تُختم كل صورة حرارة بالوقت وموقعك، وأثناء الرحلة يُرسل موقعك كل ساعة.')}
          </p>
        </div>
      </div>
      {!unsupported && (
        denied && native ? (
          <Button className="h-12 w-full text-base" onClick={() => void openLocationSettings()}><Settings className="me-2 h-5 w-5" aria-hidden="true" />{L('Open settings', 'فتح الإعدادات')}</Button>
        ) : (
          <Button className="h-12 w-full text-base" disabled={asking} onClick={async () => { setAsking(true); try { await access.request(); } finally { setAsking(false); } }}>
            {asking ? <Loader2 className="me-2 h-5 w-5 animate-spin" aria-hidden="true" /> : <MapPin className="me-2 h-5 w-5" aria-hidden="true" />}
            {denied ? L('Check again', 'تحقق مرة أخرى') : L('Allow location', 'السماح بالموقع')}
          </Button>
        )
      )}
    </section>
  );
}
