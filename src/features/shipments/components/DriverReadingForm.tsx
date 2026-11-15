import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, CheckCircle2, Loader2, MapPin, RotateCcw, ScanLine, Send, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/features/auth/auth-context';
import { useReadingUploads } from '../useReadingOutbox';
import { discardQueuedReading, UPLOAD_EVENT } from '../reading-outbox';
import { deriveEntryMode, formatStampTime, isFreshFix, placeText, type Fix, type PlaceLabels } from '../geo';
import { useSubmitReading } from '../hooks';
import { getFix, LocationError } from '../location';
import { lookupPlace } from '../place';
import { readScreen, type ScreenReading } from '../read-screen';
import { LocationAccessCard } from './LocationAccessCard';
import { needsTemperatureConfirmation, parseTemperatureInput, toggleSign, type Lang } from '../route';
import { stampPhoto } from '../stamp';
import type { Shipment } from '../types';
import type { LocationAccess } from '../useLocationAccess';

/** A photo taken longer ago than this is not "now": the driver is asked to take a new one. */
const MAX_PHOTO_AGE_MS = 10 * 60_000;
const FRESH_FIX_MS = 2 * 60_000;

interface Captured {
  requestId: string;
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
}: { shipment: Pick<Shipment, 'id' | 'reference' | 'target_temp_c' | 'tolerance_c'>; driverName: string | null; access: LocationAccess; lang: Lang }) {
  const L = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const submit = useSubmitReading();
  const { userId } = useAuth();
  const { items: uploads } = useReadingUploads();
  const [queued, setQueued] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const pending = useRef<File | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [step, setStep] = useState<'locating' | 'reading'>('locating');
  const [captured, setCaptured] = useState<Captured | null>(null);
  const [read, setRead] = useState<ScreenReading | null>(null);
  const [readState, setReadState] = useState<'none' | 'read' | 'failed'>('none');
  const [temperature, setTemperature] = useState('');
  const [setPoint, setSetPoint] = useState('');
  const [confirmedReading, setConfirmedReading] = useState('');
  const [note, setNote] = useState('');
  const [locationReason, setLocationReason] = useState<string | null>(null);

  useEffect(() => () => { if (captured) URL.revokeObjectURL(captured.previewUrl); }, [captured]);

  const reset = useCallback(() => {
    setQueued(false); setConfirmedReading(''); setCaptured(null); setRead(null); setReadState('none'); setTemperature(''); setNote('');
    setSetPoint(''); setPhase('idle'); setLocationReason(null); pending.current = null;
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
      setCaptured({ requestId: crypto.randomUUID(), stamped, previewUrl: URL.createObjectURL(stamped), fix, capturedAt, place });
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
  const entryMode = temp === null ? null : deriveEntryMode(read, temp, setPointValue);
  const needsConfirmation = temp !== null && needsTemperatureConfirmation(temp, shipment.target_temp_c, shipment.tolerance_c);
  const confirmationKey = `${captured?.capturedAt}|${temperature}|${setPoint}`;
  const signedTemp = temp === null ? '—' : `${temp > 0 ? '+' : ''}${temp}°C`;
  const ready = (!needsConfirmation || confirmedReading === confirmationKey) && !!captured && temp !== null && (setPoint.trim() === '' || setPointValue !== null) && phase === 'idle';

  const uploading = submit.isPending || uploads.some(item => item.id === captured?.requestId && item.status === 'uploading');
  const send = async () => {
    if (!ready || uploading || !captured || temp === null) return;
    setQueued(true);
    try {
      await submit.mutateAsync({
        clientRequestId: captured.requestId,
        shipmentId: shipment.id, photo: captured.stamped, temperatureC: temp, setPointC: setPointValue, note: note.trim(),
        fix: captured.fix, capturedAt: captured.capturedAt, place: captured.place, entryMode: deriveEntryMode(read, temp, setPointValue), read,
      });
      toast.success(L('Reading sent', 'تم إرسال القراءة'));
      reset();
    } catch (e) {
      const message = (e as Error).message;
      if (['QuotaExceededError','InvalidStateError','SecurityError'].includes((e as Error).name)) { toast.error(L('Device storage is full or blocked. Keep this tab open and retry before closing it.', 'تخزين الجهاز ممتلئ أو محظور. أبقِ هذه الصفحة مفتوحة وأعد المحاولة قبل إغلاقها.')); return; }
      if (message === 'SAVED_OFFLINE') { toast.info(L('Saved on this device. It will retry when the app is open and connected.', 'محفوظة على هذا الجهاز وستُرفع عندما يكون التطبيق مفتوحًا ومتصلًا.')); return; }
      toast.error(L('Could not send. Check your signal and tap Send again — your photo is kept.', 'تعذر الإرسال. تحقق من الإشارة واضغط إرسال مرة أخرى — صورتك محفوظة.') + (message ? ` (${message})` : ''));
    }
  };

  useEffect(() => {
    const listener = (event: Event) => { const detail=(event as CustomEvent<{id?:string;sent?:boolean}>).detail; if (detail?.sent && detail.id===captured?.requestId) reset(); };
    window.addEventListener(UPLOAD_EVENT, listener); return () => window.removeEventListener(UPLOAD_EVENT, listener);
  }, [captured?.requestId, reset]);

  const locked = access.permission !== 'granted';
  const areaText = captured ? placeText(captured.place ? { place_ar: captured.place.ar, place_en: captured.place.en } : null, lang) : null;

  return (
    <section className="ch-card cs-box" aria-label={L('Temperature reading', 'قراءة الحرارة')}>
      <h3><Camera aria-hidden="true" />{L('Temperature check', 'فحص الحرارة')}</h3>

      <LocationAccessCard access={access} lang={lang} />
      {access.permission === 'checking' && <p role="status">{L('Checking location access…', 'جارٍ التحقق من إذن الموقع…')}</p>}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        aria-label={L('Photo of the temperature screen', 'صورة شاشة الحرارة')}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onPhoto(f); e.target.value = ''; }}
      />

      <div style={{ display: 'grid', gap: 12 }}>
        {phase === 'working' && (
          <div className="dr-work" role="status" aria-live="polite">
            <Loader2 className="animate-spin" aria-hidden="true" />
            {step === 'locating' ? L('Getting your location…', 'جارٍ تحديد موقعك…') : L('Finding the area, stamping the photo, reading the screen…', 'جارٍ تحديد المنطقة وختم الصورة وقراءة الشاشة…')}
          </div>
        )}

        {phase === 'location-failed' && (
          <div className="cs-banner bad" role="alert">
            <TriangleAlert aria-hidden="true" />
            <div style={{ flex: 1 }}>
              <b>
                {locationReason === 'denied'
                  ? L('Location is blocked, so the photo cannot be stamped.', 'الموقع محظور، فلا يمكن ختم الصورة.')
                  : L('Could not find your location. Move to open sky or check that GPS is on.', 'تعذر تحديد موقعك. انتقل إلى مكان مكشوف أو تأكد من تشغيل GPS.')}
              </b>
              <div className="row">
                <button type="button" className="co-btn link" onClick={() => pending.current && void process(pending.current)}><RotateCcw aria-hidden="true" />{L('Try again', 'حاول مرة أخرى')}</button>
                <button type="button" className="co-btn" onClick={reset}>{L('Cancel', 'إلغاء')}</button>
              </div>
            </div>
          </div>
        )}

        {phase === 'idle' && captured && (
          <div>
            <div className="dr-reading-review"><img src={captured.previewUrl} alt={L('Your stamped photo of the temperature screen', 'صورتك المختومة لشاشة الحرارة')} className="dr-shot" />
              <div><span>{L('Temperature shown', 'الحرارة المعروضة')}</span><strong dir="ltr">{signedTemp}</strong><small>{L('Target', 'المطلوب')}: <b dir="ltr">{shipment.target_temp_c}°C</b></small>
                <small>{entryMode === 'auto' ? L('Read from photo', 'قُرئت من الصورة') : entryMode === 'auto_edited' ? L('Corrected by driver', 'صححها السائق') : L('Entered manually', 'أدخلها السائق يدويًا')}</small>
              </div>
            </div>
            <div className="dr-shotmeta">
              <MapPin aria-hidden="true" />
              <div>
                {areaText && <b>{areaText}</b>}
                <span>{formatStampTime(captured.capturedAt)}{captured.fix.accuracy != null ? ` · ±${Math.round(captured.fix.accuracy)} m` : ''}</span>
              </div>
            </div>
            <button type="button" className="cs-cta soft" style={{ marginTop: 10 }} disabled={uploading} onClick={async () => { if (queued && captured && userId) await discardQueuedReading(userId, captured.requestId); reset(); fileRef.current?.click(); }}>
              <RotateCcw aria-hidden="true" />{L('Retake photo', 'إعادة التصوير')}
            </button>
          </div>
        )}

        {phase === 'idle' && !captured && (
          <button type="button" className="dr-photo-btn" disabled={locked} onClick={() => fileRef.current?.click()}>
            <Camera aria-hidden="true" />
            <b>{L('Photograph the screen', 'صوّر الشاشة')}</b>
            <span>{locked ? L('Enable location here first to stamp the photo.', 'فعّل الموقع هنا أولًا لختم الصورة.') : L('Fill the frame with the unit’s display. Time and location are added automatically.', 'اجعل شاشة الوحدة تملأ الصورة. يُضاف الوقت والموقع تلقائيًا.')}</span>
          </button>
        )}

        {captured && phase === 'idle' && readState === 'read' && (
          <div className="cs-banner ok" role="status"><ScanLine aria-hidden="true" /><div>{L('The screen was read automatically. Check the numbers match what you see, and fix them if not.', 'تمت قراءة الشاشة تلقائيًا. تأكد أن الأرقام تطابق ما تراه وصححها إن لزم.')}</div></div>
        )}
        {captured && phase === 'idle' && readState === 'failed' && (
          <div className="cs-banner warn" role="status"><TriangleAlert aria-hidden="true" /><div>{L('The screen could not be read automatically. Type what it shows.', 'تعذرت قراءة الشاشة تلقائيًا. اكتب ما تعرضه.')}</div></div>
        )}

        <div className="cs-grid2">
          <div className="cs-field lg">
            <label htmlFor="rd-temp">{L('Temperature shown (°C)', 'الحرارة المعروضة (°م)')}</label>
            <div className="cs-with">
              <input id="rd-temp" disabled={queued} inputMode="decimal" value={temperature} onChange={(e) => setTemperature(e.target.value)} placeholder="8.5" dir="ltr" aria-invalid={temperature !== '' && temp === null} />
              <button type="button" className="co-tool" disabled={queued} onClick={() => setTemperature((v) => toggleSign(v))} aria-label={L('Switch between plus and minus', 'تبديل بين الموجب والسالب')}>±</button>
            </div>
          </div>
          <div className="cs-field lg">
            <label htmlFor="rd-set">{L('Set point shown (°C)', 'درجة الضبط (°م)')}</label>
            <div className="cs-with">
              <input id="rd-set" disabled={queued} inputMode="decimal" value={setPoint} onChange={(e) => setSetPoint(e.target.value)} dir="ltr" aria-invalid={setPoint.trim() !== '' && setPointValue === null} />
              <button type="button" className="co-tool" disabled={queued} onClick={() => setSetPoint((v) => toggleSign(v))} aria-label={L('Switch between plus and minus', 'تبديل بين الموجب والسالب')}>±</button>
            </div>
          </div>
        </div>
        {temperature !== '' && temp === null && (
          <p style={{ margin: 0, fontSize: 11, color: '#f0245b' }} role="alert">{L('Type a number between -60 and 60, like 8.5 or -15.', 'اكتب رقمًا بين -60 و60 مثل 8.5 أو -15.')}</p>
        )}

        <div className="cs-field">
          <label htmlFor="rd-note">{L('Note (optional)', 'ملاحظة (اختياري)')}</label>
          <input id="rd-note" disabled={queued} value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
        </div>

        {captured && temp !== null && needsConfirmation && (
          <div className="cs-banner warn dr-sign-check" role="alert">
            <TriangleAlert aria-hidden="true" />
            <div>
              <b>{L('Large deviation: check the photo and temperature sign', 'فرق كبير: راجع الصورة وإشارة الحرارة')}</b>
              <p>{L('Reading', 'القراءة')}: <strong dir="ltr">{signedTemp}</strong> · {L('Target', 'المطلوب')}: <strong dir="ltr">{shipment.target_temp_c}°C</strong></p>
              <span>{L('Check the photo and the +/− sign. A genuine out-of-range reading can still be sent.', 'راجع الصورة وإشارة +/−. يمكنك إرسال القراءة الفعلية حتى إن كانت خارج النطاق.')}</span>
              <label><input type="checkbox" disabled={queued} checked={confirmedReading === confirmationKey} onChange={e => setConfirmedReading(e.target.checked ? confirmationKey : '')} />{L('I checked the photo and temperature sign', 'راجعت الصورة وإشارة الحرارة')}</label>
            </div>
          </div>
        )}
        <button type="button" className="cs-cta" disabled={!ready || uploading} onClick={send}>
          {submit.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : captured ? <CheckCircle2 aria-hidden="true" /> : <Send className="rtl:-scale-x-100" aria-hidden="true" />}
          {submit.isPending ? L('Sending…', 'جارٍ الإرسال…') : L('Send reading', 'إرسال القراءة')}
        </button>
        {!ready && phase === 'idle' && <p style={{ margin: 0, textAlign: 'center', fontSize: 11, color: '#6b7a9c' }}>{L('Take the photo and confirm the temperature to send.', 'التقط الصورة وأكّد الحرارة للإرسال.')}</p>}
      </div>
    </section>
  );
}
