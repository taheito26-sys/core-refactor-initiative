import { ExternalLink, MapPin } from 'lucide-react';
import { agoLabel, type Lang } from '../route';
import { LOCATION_SOURCE_LABELS, formatCoords, mapEmbedUrl, mapsLink } from '../geo';
import type { ShipmentLocation } from '../types';

/**
 * Where the driver last reported from: a map, how long ago, how precise, and what the point came from
 * (the hourly update, a temperature photo, or a confirmed stop).
 */
export function LocationCard({ location, lang, now }: { location: ShipmentLocation | null; lang: Lang; now: number }) {
  const L = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  if (!location) {
    return (
      <p className="flex items-center gap-2 rounded-2xl bg-muted/50 p-4 text-sm text-muted-foreground">
        <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />
        {L('The driver has not shared a location yet.', 'لم يشارك السائق موقعه بعد.')}
      </p>
    );
  }
  const source = LOCATION_SOURCE_LABELS[location.source];
  return (
    <div className="space-y-3">
      <iframe
        title={L('Map of the truck’s last known position', 'خريطة آخر موقع معروف للشاحنة')}
        src={mapEmbedUrl(location.latitude, location.longitude)}
        className="h-56 w-full rounded-2xl border border-border bg-muted"
        loading="lazy"
        referrerPolicy="no-referrer"
      />
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm">
        <div>
          <span className="font-bold">{L('Last seen', 'آخر ظهور')} {agoLabel(location.recorded_at, now, lang)}</span>
          <span className="text-muted-foreground"> · {lang === 'ar' ? source.ar : source.en}{location.accuracy_m != null ? ` · ±${Math.round(location.accuracy_m)} m` : ''}</span>
        </div>
        <a className="inline-flex items-center gap-1.5 font-semibold text-primary hover:underline" href={mapsLink(location.latitude, location.longitude)} target="_blank" rel="noreferrer">
          <ExternalLink className="h-4 w-4" aria-hidden="true" />{L('Open in Maps', 'فتح في الخرائط')}
        </a>
      </div>
      <div className="text-xs text-muted-foreground" dir="ltr" style={{ textAlign: 'start' }}>{formatCoords(location.latitude, location.longitude)}</div>
    </div>
  );
}
