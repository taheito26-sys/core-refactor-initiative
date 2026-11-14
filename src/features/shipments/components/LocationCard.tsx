import { ExternalLink, MapPin } from 'lucide-react';
import { agoLabel, type Lang } from '../route';
import { LOCATION_SOURCE_LABELS, formatCoords, mapEmbedUrl, mapsLink, placeText } from '../geo';
import type { ShipmentLocation } from '../types';

/**
 * Where the driver last reported from: the area by name, a map, how long ago and how precise, and the recent
 * trail of points (the hourly updates, temperature photos and confirmed stops) with the area of each.
 */
export function LocationCard({ location, trail = [], lang, now }: { location: ShipmentLocation | null; trail?: ShipmentLocation[]; lang: Lang; now: number }) {
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
  const area = placeText(location, lang);
  const earlier = trail.filter((p) => p.recorded_at !== location.recorded_at).slice(0, 8);
  return (
    <div className="space-y-3">
      {area && <div className="text-lg font-bold leading-snug">{area}</div>}
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

      {earlier.length > 0 && (
        <div className="space-y-1.5 pt-1">
          <h4 className="text-xs font-bold text-muted-foreground">{L('Earlier positions', 'مواقع سابقة')}</h4>
          <ul className="divide-y divide-border rounded-2xl border border-border">
            {earlier.map((p) => (
              <li key={p.recorded_at} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="min-w-0 truncate font-medium">{placeText(p, lang) ?? <span dir="ltr">{formatCoords(p.latitude, p.longitude)}</span>}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{agoLabel(p.recorded_at, now, lang)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
