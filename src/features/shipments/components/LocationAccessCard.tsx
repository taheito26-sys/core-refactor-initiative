import { Loader2, MapPin, MapPinOff, Settings } from 'lucide-react';
import { useState } from 'react';
import { canTrackInBackground, openLocationSettings } from '../native-tracker';
import type { Lang } from '../route';
import type { LocationAccess } from '../useLocationAccess';

/**
 * Asks the driver for location, and says what is wrong when it is off. Location is required: every photo is
 * stamped with the position, and while a trip is on the road the position goes out about every hour.
 */
export function LocationAccessCard({ access, lang }: { access: LocationAccess; lang: Lang }) {
  const L = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const [asking, setAsking] = useState(false);
  const native = canTrackInBackground();

  if (access.permission === 'checking') return null;

  if (access.permission === 'granted') {
    if (!(access.backgroundDenied && native)) return null;
    return (
      <div className="cs-banner warn" role="alert">
        <Settings aria-hidden="true" />
        <div>
          {L('Allow location and notifications in settings so your position keeps updating with the screen off.', 'اسمح بالموقع والإشعارات من الإعدادات ليستمر تحديث موقعك والشاشة مطفأة.')}
          <div className="row"><button type="button" className="co-btn link" onClick={() => void openLocationSettings()}><Settings aria-hidden="true" />{L('Open settings', 'فتح الإعدادات')}</button></div>
        </div>
      </div>
    );
  }

  const denied = access.permission === 'denied';
  const unsupported = access.permission === 'unsupported';
  return (
    <section className="cs-banner warn" role="alert">
      {denied || unsupported ? <MapPinOff aria-hidden="true" /> : <MapPin aria-hidden="true" />}
      <div style={{ flex: 1 }}>
        <b>
          {unsupported ? L('This phone can’t share its location', 'هذا الهاتف لا يستطيع مشاركة الموقع')
            : denied ? L('Location is blocked', 'الموقع محظور')
              : L('Allow location to send readings', 'اسمح بالموقع لإرسال القراءات')}
        </b>
        {denied
          ? L('Open your phone’s settings for this app and set Location to Allow. Temperature photos cannot be sent without it.', 'افتح إعدادات الهاتف لهذا التطبيق واجعل الموقع «سماح». لا يمكن إرسال صور الحرارة بدونه.')
          : L('Every temperature photo is stamped with the time and your position.', 'تُختم كل صورة حرارة بالوقت وموقعك.')}
        {!unsupported && (
          <div className="row" style={{ marginTop: 10 }}>
            {denied && native ? (
              <button type="button" className="cs-cta" onClick={() => void openLocationSettings()}><Settings aria-hidden="true" />{L('Open settings', 'فتح الإعدادات')}</button>
            ) : (
              <button type="button" className="cs-cta" disabled={asking} onClick={async () => { setAsking(true); try { await access.request(); } finally { setAsking(false); } }}>
                {asking ? <Loader2 className="animate-spin" aria-hidden="true" /> : <MapPin aria-hidden="true" />}
                {denied ? L('Check again', 'تحقق مرة أخرى') : L('Allow location', 'السماح بالموقع')}
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
