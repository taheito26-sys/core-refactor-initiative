import { useQuery } from '@tanstack/react-query';
import { placeText, type Lang } from '../geo';
import { lookupPlaceForViewer } from '../place';

interface Point {
  latitude: number | null;
  longitude: number | null;
  place_ar?: string | null;
  place_en?: string | null;
}

/** The area of a position as words ("Safaga, Red Sea Governorate, Egypt"), looked up when the row was saved without one. */
export function useAreaText(point: Point | null | undefined, lang: Lang): string | null {
  const stored = placeText(point, lang);
  const hasPoint = !!point && point.latitude != null && point.longitude != null;
  const { data } = useQuery({
    queryKey: ['shipment-area', point?.latitude != null ? point.latitude.toFixed(2) : null, point?.longitude != null ? point.longitude.toFixed(2) : null],
    queryFn: () => lookupPlaceForViewer(point!.latitude!, point!.longitude!),
    enabled: hasPoint && !stored,
    staleTime: Infinity,
    retry: false,
  });
  return stored ?? placeText(data ? { place_ar: data.ar, place_en: data.en } : null, lang);
}

export function AreaText({ point, lang, fallback = null }: { point: Point | null | undefined; lang: Lang; fallback?: string | null }) {
  const text = useAreaText(point, lang);
  return <>{text ?? fallback}</>;
}
