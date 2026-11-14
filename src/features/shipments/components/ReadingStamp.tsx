import { ExternalLink, MapPin, ScanLine, TriangleAlert } from 'lucide-react';
import { ENTRY_MODE_LABELS, formatCoords, formatStampTime, mapsLink } from '../geo';
import type { Lang } from '../route';
import type { ShipmentReading } from '../types';

/** The proof attached to a reading: the phone's time and position, and how the number was entered. */
export function ReadingStamp({ reading, lang }: { reading: ShipmentReading; lang: Lang }) {
  const L = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const mode = ENTRY_MODE_LABELS[reading.entry_mode];
  const hasPlace = reading.latitude != null && reading.longitude != null;
  return (
    <div className="space-y-1 text-xs text-muted-foreground">
      {reading.device_taken_at && <div dir="ltr" style={{ textAlign: 'start' }}>{formatStampTime(new Date(reading.device_taken_at).getTime())}</div>}
      {hasPlace && (
        <a className="inline-flex items-center gap-1.5 hover:text-primary" href={mapsLink(reading.latitude as number, reading.longitude as number)} target="_blank" rel="noreferrer">
          <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
          <span dir="ltr">{formatCoords(reading.latitude as number, reading.longitude as number)}{reading.accuracy_m != null ? ` ±${Math.round(reading.accuracy_m)} m` : ''}</span>
          <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </a>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="inline-flex items-center gap-1.5"><ScanLine className="h-3.5 w-3.5" aria-hidden="true" />{lang === 'ar' ? mode.ar : mode.en}</span>
        {reading.time_mismatch && (
          <span className="inline-flex items-center gap-1.5 font-semibold text-amber-700 dark:text-amber-400"><TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" />{L('Phone clock differs from the server', 'ساعة الهاتف تختلف عن الخادم')}</span>
        )}
      </div>
    </div>
  );
}
