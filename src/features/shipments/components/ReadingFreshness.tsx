import { agoLabel, isReadingStale, type Lang } from '../route';

/** Keep the reading's age visible beside its value, especially when no fresh evidence exists. */
export function ReadingFreshness({ takenAt, intervalHours, active, now, lang }: {
  takenAt: string | null; intervalHours: number; active: boolean; now: number; lang: Lang;
}) {
  const stale = active && isReadingStale(takenAt, intervalHours, now);
  return <div className={stale ? 'cs-reading-age stale' : 'cs-reading-age'} role={stale ? 'status' : undefined}>
    <span>{takenAt ? (lang === 'ar' ? `سُجلت ${agoLabel(takenAt, now, lang)}` : `Recorded ${agoLabel(takenAt, now, lang)}`) : (lang === 'ar' ? 'لا توجد قراءة مسجلة' : 'No recorded reading')}</span>
    {stale && <strong>{lang === 'ar' ? 'الحرارة الحالية غير معروفة — أرسل قراءة جديدة' : 'Current temperature unknown — new reading required'}</strong>}
  </div>;
}
