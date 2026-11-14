import { ExternalLink, MapPin, MapPinned, ScanLine, Timer, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ENTRY_MODE_LABELS, formatStampTime, mapsLink } from '../geo';
import { useAreaText } from './AreaText';
import { agoLabel, type Lang } from '../route';
import type { ShipmentReading } from '../types';
import { PhotoThumb } from './PhotoThumb';

const temp = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** The proof on one reading: the area, when the phone took it, where, and how the number was entered. */
export function ReadingProof({ reading, lang }: { reading: ShipmentReading; lang: Lang }) {
  const L = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const area = useAreaText(reading, lang);
  const mode = ENTRY_MODE_LABELS[reading.entry_mode];
  return (
    <div className="cs-meta">
      {area && <div><MapPin aria-hidden="true" /><b>{area}</b></div>}
      {reading.device_taken_at && <div><Timer aria-hidden="true" /><span className="dir">{formatStampTime(new Date(reading.device_taken_at).getTime())}</span></div>}
      {reading.latitude != null && reading.longitude != null && (
        <div>
          <MapPinned aria-hidden="true" />
          <a className="cs-link dir" href={mapsLink(reading.latitude, reading.longitude)} target="_blank" rel="noreferrer">
            {L('Open in maps', 'فتح في الخرائط')}{reading.accuracy_m != null ? ` · ±${Math.round(reading.accuracy_m)} m` : ''}<ExternalLink aria-hidden="true" />
          </a>
        </div>
      )}
      <div><ScanLine aria-hidden="true" />{lang === 'ar' ? mode.ar : mode.en}</div>
      {reading.time_mismatch && <div className="warn"><TriangleAlert aria-hidden="true" />{L('Phone clock differs from the server', 'ساعة الهاتف تختلف عن الخادم')}</div>}
    </div>
  );
}

/** One sent reading: its photo, the temperature, when, and the proof. */
export function ReadingRow({ reading: r, lang, now }: { reading: ShipmentReading; lang: Lang; now: number }) {
  const L = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  return (
    <li style={{ alignItems: 'flex-start' }}>
      <div className="cs-rd" style={{ width: '100%' }}>
        <div className="cs-photo"><PhotoThumb path={r.photo_path} alt={L('Temperature screen photo', 'صورة شاشة الحرارة')} className="h-full w-full rounded-none" /></div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className={cn('cs-rd-t', r.is_alert && 'bad')}>{temp(r.temperature_c)}°C{r.is_alert && <span style={{ fontSize: 10, marginInlineStart: 6 }}>{L('Out of range', 'خارج النطاق')}</span>}</div>
          <div className="cs-rd-s">{agoLabel(r.taken_at, now, lang)}</div>
          <ReadingProof reading={r} lang={lang} />
        </div>
      </div>
    </li>
  );
}
