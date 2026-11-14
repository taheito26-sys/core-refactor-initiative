import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, CheckCircle2, Loader2, MapPin, RotateCcw, ScanLine, Send, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { deriveEntryMode, formatCoords, formatStampTime, isFreshFix, placeText, type Fix, type PlaceLabels } from '../geo';
import { useSubmitReading } from '../hooks';
import { getFix, LocationError } from '../location';
import { lookupPlace } from '../place';
import { readScreen, type ScreenReading } from '../read-screen';
import { parseTemperatureInput, toggleSign, type Lang } from '../route';
import { stampPhoto } from '../stamp';
import type { Shipment } from '../types';
import type { LocationAccess } from '../useLocationAccess';

/** A photo taken longer ago than this is not "now": the driver is asked to take a new one. */
const MAX_PHOTO_AGE_MS = 10 * 60_000;
const FRESH_FIX_MS = 2 * 60_000;

interface Captured {
  stamped: Blob;
  previewUrl: string;
  fix: Fix;
  capturedAt: number;
  place: PlaceLabels | null;
}

type Phase = 'idle' | 'working' | 'location-failed';

/**
 * The driver's temperature check. The photo is stamped with the phone's time and position the moment it is
 * taken, the system tries to read the temperature off the screen and fills the fields, and the driver
 * confirms or types them. Without location nothing can be sent.
 */
export function DriverReadingForm({
  shipment, driverName, access, lang,
}: { shipment: Pick<Shipment, 'id' | 'reference' | 'target_temp_c'>; driverName: string | null; access: LocationAccess; lang: Lang }) {
  const L = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const submit = useSubmitReading();
  const fileRef = useRef<HTMLInputElement>(null);
  const pending = useRef<File | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [step, setStep] = useState<'locating' | 'reading'>('locating');
  const [captured, setCaptured] = useState<Captured | null>(null);
  const [read, setRead] = useState<ScreenReading | null>(null);
  const [readState, setReadState] = useState<'none' | 'read' | 'failed'>('none');
  const [temperature, setTemperature] = useState('');
  const [setPoint, setSetPoint] = useState(String(shipment.target_temp_c));
  const [note, setNote] = useState('');
  const [locationReason, setLocationReason] = useState<string | null>(null);

  useEffect(() => () => { if (captured) URL.revokeObjectURL(captured.previewUrl); }, [captured]);

  const reset = useCallback(() => {
    setCaptured(null); setRead(null); setReadState('none'); setTemperature(''); setNote('');
    setSetPoint(String(shipment.target_temp_c)); setPhase('idle'); setLocationReason(null); pending.current = null;
  }, [shipment.target_temp_c]);

  /** A fix taken now; failing that, a recent one; failing that, nothing, and the driver cannot proceed. */
  const acquireFix = async (): Promise<Fix> => {
    try {
      const fix = await getFix({ timeoutMs: 15_000, maxAgeMs: 30_000, highAccuracy: true });
      if (isFreshFix(fix, Date.now(), FRESH_FIX_MS)) return fix;
    } catch (e) {
      if (e instanceof LocationError && e.reason === 'denied') throw e;
    }
    const recent = await getFix({ timeoutMs: 6_000, maxAgeMs: 10 * 60_000, highAccuracy: false });
    if (!isFreshFix(recent, Date.now(), 10 * 60_000)) throw new LocationError('unavailable');
    return recent;
  };

  const process = async (file: File) => {
    pending.current = file;
    setPhase('working'); setStep('locating'); setLocationReason(null);
    // The reader works from the plain photo while the position is found.
    const reading = readScreen(file);
    let fix: Fix;
    try {
      fix = await acquireFix();
    } catch (e) {
      setLocationReason(e instanceof LocationError ? e.reason : 'unavailable');
      setPhase('location-failed');
      return;
    }
    try {
      setStep('reading');
      const capturedAt = file.lastModified && Math.abs(Date.now() - file.lastModified) <= MAX_PHOTO_AGE_MS ? file.lastModified : Date.now();
      const place = await lookupPlace(fix.latitude, fix.longitude);
      const stamped = await stampPhoto(file, { capturedAt, fix, reference: shipment.reference, driverName, place: placeText(place ? { place_ar: place.ar, place_en: place.en } : null, lang) });
      const result = await reading;
      setCaptured({ stamped, previewUrl: URL.createObjectURL(stamped), fix, capturedAt, place });
      setRead(result);
      if (result) {
        setReadState('read');
        setTemperature(String(result.temperature));
        if (result.setPoint !== null) setSetPoint(String(result.setPoint));
      } else {
        setReadState('failed');
      }
      setPhase('idle');
    } catch (e) {
      reset();
      toast.error((e as Error).message === 'PHOTO_TOO_LARGE'
        ? L('The photo is too large. Take it again.', 'الصورة كبيرة جدًا. التقطها مرة أخرى.')
        : L('That photo could not be used. Take it again.', 'تعذر استخدام هذه الصورة. التقطها مرة أخرى.'));
    }
  };

  const onPhoto = (file: File) => {
    if (file.lastModified && Math.abs(Date.now() - file.lastModified) > MAX_PHOTO_AGE_MS) {
      toast.error(L('That photo is not from just now. Take a new photo of the screen.', 'هذه الصورة ليست من الآن. التقط صورة جديدة للشاشة.'));
      return;
    }
    void process(file);
  };

  const temp = parseTemperatureInput(temperature);
  const setPointValue = setPoint.trim() ? parseTemperatureInput(setPoint) : null;
  const ready = !!captured && temp !== null && (setPoint.trim() === '' || setPointValue !== null) && phase === 'idle';

  const send = async () => {
    if (!captured || temp === null) return;
    try {
      await submit.mutateAsync({
        shipmentId: shipment.id, photo: captured.stamped, temperatureC: temp, setPointC: setPointValue, note: note.trim(),
        fix: captured.fix, capturedAt: captured.capturedAt, place: captured.place, entryMode: deriveEntryMode(read, temp, setPointValue), read,
      });
      toast.success(L('Reading sent', 'تم إرسال القراءة'));
      reset();
    } catch (e) {
      const message = (e as Error).message;
      toast.error(L('Could not send. Check your signal and tap Send again — your photo is kept.', 'تعذر الإرسال. تحقق من الإشارة واضغط إرسال مرة أخرى — صورتك محفوظة.') + (message ? ` (${message})` : ''));
    }
  };

  const locked = access.permission !== 'granted';

  return (
    <section className="space-y-4 rounded-2xl border border-border bg-card p-4" aria-label={L('Temperature reading', 'قراءة الحرارة')}>
      <h2 className="text-lg font-bold">{L('Temperature check', 'فحص الحرارة')}</h2>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        aria-label={L('Photo of the temperature screen', 'صورة شاشة الحرارة')}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onPhoto(f); e.target.value = ''; }}
      />

      {phase === 'working' && (
        <div className="flex h-44 flex-col items-center justify-center gap-3 rounded-xl border border-border bg-muted/40 text-center" role="status" aria-live="polite">
          <Loader2 className="h-9 w-9 animate-spin text-primary" aria-hidden="true" />
          <div className="text-base font-bold">{step === 'locating' ? L('Getting your location…', 'جارٍ تحديد موقعك…') : L('Finding the area, stamping the photo, reading the screen…', 'جارٍ تحديد المنطقة وختم الصورة وقراءة الشاشة…')}</div>
        </div>
      )}

      {phase === 'location-failed' && (
        <div className="space-y-3 rounded-xl border border-destructive/40 bg-destructive/5 p-4" role="alert">
          <div className="flex items-start gap-2 text-sm font-semibold text-destructive"><TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {locationReason === 'denied'
              ? L('Location is blocked, so the photo cannot be stamped.', 'الموقع محظور، فلا يمكن ختم الصورة.')
              : L('Could not find your location. Move to open sky or check that GPS is on.', 'تعذر تحديد موقعك. انتقل إلى مكان مكشوف أو تأكد من تشغيل GPS.')}
          </div>
          <div className="flex gap-2">
            <Button className="h-12 flex-1" onClick={() => pending.current && void process(pending.current)}><RotateCcw className="me-2 h-4 w-4" aria-hidden="true" />{L('Try again', 'حاول مرة أخرى')}</Button>
            <Button variant="outline" className="h-12" onClick={reset}>{L('Cancel', 'إلغاء')}</Button>
          </div>
        </div>
      )}

      {phase === 'idle' && captured && (
        <div className="space-y-2">
          <img src={captured.previewUrl} alt={L('Your stamped photo of the temperature screen', 'صورتك المختومة لشاشة الحرارة')} className="max-h-80 w-full rounded-xl bg-muted object-contain" />
          <div className="flex items-start gap-2 text-xs text-muted-foreground">
            <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="text-start">
              {placeText(captured.place ? { place_ar: captured.place.ar, place_en: captured.place.en } : null, lang) && (
                <b className="block text-sm text-foreground">{placeText({ place_ar: captured.place?.ar, place_en: captured.place?.en }, lang)}</b>
              )}
              <span dir="ltr" className="block">{formatStampTime(captured.capturedAt)} · {formatCoords(captured.fix.latitude, captured.fix.longitude)}{captured.fix.accuracy != null ? ` ±${Math.round(captured.fix.accuracy)} m` : ''}</span>
            </span>
          </div>
          <Button type="button" variant="outline" className="h-12 w-full" onClick={() => { reset(); fileRef.current?.click(); }}>
            <RotateCcw className="me-2 h-4 w-4" aria-hidden="true" />{L('Retake photo', 'إعادة التصوير')}
          </Button>
        </div>
      )}

      {phase === 'idle' && !captured && (
        <button
          type="button"
          disabled={locked}
          onClick={() => fileRef.current?.click()}
          className="flex h-44 w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-primary/50 bg-primary/5 text-primary transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Camera className="h-11 w-11" aria-hidden="true" />
          <span className="text-lg font-bold">{L('Photograph the screen', 'صوّر الشاشة')}</span>
          <span className="px-4 text-center text-sm text-muted-foreground">
            {locked ? L('Allow location above first.', 'اسمح بالموقع أعلاه أولًا.') : L('Fill the frame with the unit’s display. Time and location are added automatically.', 'اجعل شاشة الوحدة تملأ الصورة. يُضاف الوقت والموقع تلقائيًا.')}
          </span>
        </button>
      )}

      {captured && phase === 'idle' && readState === 'read' && (
        <div className="flex items-start gap-2 rounded-xl bg-emerald-500/10 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-300" role="status">
          <ScanLine className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {L('The screen was read automatically. Check the numbers match what you see, and fix them if not.', 'تمت قراءة الشاشة تلقائيًا. تأكد أن الأرقام تطابق ما تراه وصححها إن لزم.')}
        </div>
      )}
      {captured && phase === 'idle' && readState === 'failed' && (
        <div className="flex items-start gap-2 rounded-xl bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300" role="status">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {L('The screen could not be read automatically. Type what it shows.', 'تعذرت قراءة الشاشة تلقائيًا. اكتب ما تعرضه.')}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="rd-temp" className="text-sm">{L('Temperature shown (°C)', 'الحرارة المعروضة (°م)')}</Label>
          <div className="flex gap-2">
            <Input id="rd-temp" inputMode="decimal" value={temperature} onChange={(e) => setTemperature(e.target.value)} placeholder="8.5" className="h-12 text-lg font-bold" dir="ltr" aria-invalid={temperature !== '' && temp === null} />
            <Button type="button" variant="outline" className="h-12 w-12 shrink-0 text-lg" onClick={() => setTemperature((v) => toggleSign(v))} aria-label={L('Switch between plus and minus', 'تبديل بين الموجب والسالب')}>±</Button>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rd-set" className="text-sm">{L('Set point shown (°C)', 'درجة الضبط (°م)')}</Label>
          <div className="flex gap-2">
            <Input id="rd-set" inputMode="decimal" value={setPoint} onChange={(e) => setSetPoint(e.target.value)} className="h-12 text-lg font-bold" dir="ltr" aria-invalid={setPoint.trim() !== '' && setPointValue === null} />
            <Button type="button" variant="outline" className="h-12 w-12 shrink-0 text-lg" onClick={() => setSetPoint((v) => toggleSign(v))} aria-label={L('Switch between plus and minus', 'تبديل بين الموجب والسالب')}>±</Button>
          </div>
        </div>
      </div>
      {temperature !== '' && temp === null && (
        <p className="text-sm text-destructive" role="alert">{L('Type a number between -60 and 60, like 8.5 or -15.', 'اكتب رقمًا بين -60 و60 مثل 8.5 أو -15.')}</p>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="rd-note" className="text-sm">{L('Note (optional)', 'ملاحظة (اختياري)')}</Label>
        <Input id="rd-note" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} className="h-11" />
      </div>

      <Button type="button" className="h-14 w-full text-base" disabled={!ready || submit.isPending} onClick={send}>
        {submit.isPending ? <Loader2 className="me-2 h-5 w-5 animate-spin" aria-hidden="true" /> : captured ? <CheckCircle2 className="me-2 h-5 w-5" aria-hidden="true" /> : <Send className="me-2 h-5 w-5 rtl:-scale-x-100" aria-hidden="true" />}
        {submit.isPending ? L('Sending…', 'جارٍ الإرسال…') : L('Send reading', 'إرسال القراءة')}
      </Button>
      {!ready && phase === 'idle' && <p className="text-center text-sm text-muted-foreground">{L('Take the photo and confirm the temperature to send.', 'التقط الصورة وأكّد الحرارة للإرسال.')}</p>}
    </section>
  );
}
