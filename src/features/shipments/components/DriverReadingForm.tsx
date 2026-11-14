import { useEffect, useRef, useState } from 'react';
import { Camera, Loader2, RotateCcw, Send } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useSubmitReading } from '../hooks';
import { parseTemperatureInput, toggleSign, type Lang } from '../route';
import type { Shipment } from '../types';

/**
 * The driver's temperature check: photograph the reefer screen, type what it shows, send. The photo
 * and the numbers stay in the form if the upload fails (no signal on the road), so a retry is one tap.
 */
export function DriverReadingForm({ shipment, lang }: { shipment: Pick<Shipment, 'id' | 'target_temp_c'>; lang: Lang }) {
  const L = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const submit = useSubmitReading();
  const fileRef = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [temperature, setTemperature] = useState('');
  const [setPoint, setSetPoint] = useState(String(shipment.target_temp_c));
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!photo) { setPreview(null); return; }
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  const temp = parseTemperatureInput(temperature);
  const setPointValue = setPoint.trim() ? parseTemperatureInput(setPoint) : null;
  const ready = !!photo && temp !== null && (setPoint.trim() === '' || setPointValue !== null);

  const send = async () => {
    if (!photo || temp === null) return;
    try {
      await submit.mutateAsync({ shipmentId: shipment.id, photo, temperatureC: temp, setPointC: setPointValue, note: note.trim() });
      toast.success(L('Reading sent', 'تم إرسال القراءة'));
      setPhoto(null); setTemperature(''); setNote('');
      setSetPoint(String(shipment.target_temp_c));
    } catch (e) {
      const message = (e as Error).message;
      toast.error(
        message === 'PHOTO_TOO_LARGE'
          ? L('The photo is too large. Take it again.', 'الصورة كبيرة جدًا. التقطها مرة أخرى.')
          : L('Could not send. Check your signal and tap Send again — your photo is kept.', 'تعذر الإرسال. تحقق من الإشارة واضغط إرسال مرة أخرى — صورتك محفوظة.') + (message ? ` (${message})` : ''),
      );
    }
  };

  return (
    <section className="space-y-3 rounded-2xl border border-border bg-card p-4" aria-label={L('Temperature reading', 'قراءة الحرارة')}>
      <h2 className="text-base font-bold">{L('Temperature check', 'فحص الحرارة')}</h2>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        aria-label={L('Photo of the temperature screen', 'صورة شاشة الحرارة')}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) setPhoto(f); e.target.value = ''; }}
      />

      {preview ? (
        <div className="space-y-2">
          <img src={preview} alt={L('Your photo of the temperature screen', 'صورتك لشاشة الحرارة')} className="max-h-72 w-full rounded-xl object-contain bg-muted" />
          <Button type="button" variant="outline" className="w-full" onClick={() => fileRef.current?.click()}>
            <RotateCcw className="me-2 h-4 w-4" aria-hidden="true" />{L('Retake photo', 'إعادة التصوير')}
          </Button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="flex h-40 w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-primary/50 bg-primary/5 text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <Camera className="h-10 w-10" aria-hidden="true" />
          <span className="text-base font-bold">{L('Photograph the screen', 'صوّر الشاشة')}</span>
          <span className="px-4 text-center text-xs text-muted-foreground">{L('Fill the frame with the refrigeration unit’s display.', 'اجعل شاشة وحدة التبريد تملأ الصورة.')}</span>
        </button>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="rd-temp">{L('Temperature shown (°C)', 'الحرارة المعروضة (°م)')}</Label>
          <div className="flex gap-2">
            <Input id="rd-temp" inputMode="decimal" value={temperature} onChange={(e) => setTemperature(e.target.value)} placeholder="8.5" className="h-12 text-lg font-bold" dir="ltr" aria-invalid={temperature !== '' && temp === null} />
            <Button type="button" variant="outline" className="h-12 w-12 shrink-0 text-lg" onClick={() => setTemperature((v) => toggleSign(v))} aria-label={L('Switch between plus and minus', 'تبديل بين الموجب والسالب')}>±</Button>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rd-set">{L('Set point shown (°C)', 'درجة الضبط (°م)')}</Label>
          <div className="flex gap-2">
            <Input id="rd-set" inputMode="decimal" value={setPoint} onChange={(e) => setSetPoint(e.target.value)} className="h-12 text-lg font-bold" dir="ltr" aria-invalid={setPoint.trim() !== '' && setPointValue === null} />
            <Button type="button" variant="outline" className="h-12 w-12 shrink-0 text-lg" onClick={() => setSetPoint((v) => toggleSign(v))} aria-label={L('Switch between plus and minus', 'تبديل بين الموجب والسالب')}>±</Button>
          </div>
        </div>
      </div>
      {temperature !== '' && temp === null && (
        <p className="text-xs text-destructive" role="alert">{L('Type a number between -60 and 60, like 8.5 or -15.', 'اكتب رقمًا بين -60 و60 مثل 8.5 أو -15.')}</p>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="rd-note">{L('Note (optional)', 'ملاحظة (اختياري)')}</Label>
        <Input id="rd-note" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
      </div>

      <Button type="button" className="h-12 w-full text-base" disabled={!ready || submit.isPending} onClick={send}>
        {submit.isPending ? <Loader2 className="me-2 h-5 w-5 animate-spin" aria-hidden="true" /> : <Send className="me-2 h-5 w-5 rtl:-scale-x-100" aria-hidden="true" />}
        {submit.isPending ? L('Sending…', 'جارٍ الإرسال…') : L('Send reading', 'إرسال القراءة')}
      </Button>
      {!ready && <p className="text-center text-[11px] text-muted-foreground">{L('Take the photo and type the temperature to send.', 'التقط الصورة واكتب الحرارة للإرسال.')}</p>}
    </section>
  );
}
