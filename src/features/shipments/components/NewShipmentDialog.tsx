import { useState } from 'react';
import { Loader2, MapPin, PlusSquare } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCreateShipment, useDrivers } from '../hooks';
import {
  DEFAULT_READING_INTERVAL_HOURS, DEFAULT_TARGET_TEMP_C, DEFAULT_TOLERANCE_C, FIXED_ROUTE, fixedRouteForRpc,
  parseTemperatureInput, toggleSign, type Lang,
} from '../route';

const INTERVALS = [1, 2, 3, 4, 6, 8, 12];
const selectClass = 'h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** Dispatch a shipment: what is on the truck, the temperature it must hold, how often to photograph it, and who drives. */
export function NewShipmentDialog({
  open, onOpenChange, lang, onManageDrivers, onCreated,
}: { open: boolean; onOpenChange: (open: boolean) => void; lang: Lang; onManageDrivers: () => void; onCreated: (id: string) => void }) {
  const L = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const { data: drivers = [] } = useDrivers();
  const create = useCreateShipment();
  const [cargo, setCargo] = useState('');
  const [weight, setWeight] = useState('');
  const [target, setTarget] = useState(String(DEFAULT_TARGET_TEMP_C));
  const [tolerance, setTolerance] = useState(String(DEFAULT_TOLERANCE_C));
  const [interval, setIntervalHours] = useState(DEFAULT_READING_INTERVAL_HOURS);
  const [driverId, setDriverId] = useState('');
  const [note, setNote] = useState('');

  const submit = async () => {
    const targetC = parseTemperatureInput(target);
    const toleranceC = Number(tolerance.replace(',', '.'));
    const weightTons = weight.trim() ? Number(weight.replace(',', '.')) : null;
    if (!cargo.trim()) return toast.error(L('Describe the cargo', 'اكتب وصف الشحنة'));
    if (targetC === null) return toast.error(L('Enter the temperature the cargo must be kept at', 'أدخل درجة الحرارة المطلوبة للشحنة'));
    if (!Number.isFinite(toleranceC) || toleranceC < 0 || toleranceC > 30) return toast.error(L('Tolerance must be between 0 and 30 °C', 'هامش السماح بين 0 و30 درجة'));
    if (weightTons !== null && (!Number.isFinite(weightTons) || weightTons <= 0)) return toast.error(L('Weight must be above zero', 'الوزن يجب أن يكون أكبر من صفر'));
    try {
      const shipment = await create.mutateAsync({
        cargo: cargo.trim(), weightTons, targetTempC: targetC, toleranceC, intervalHours: interval,
        driverId: driverId || null, note: note.trim(), stops: fixedRouteForRpc(),
      });
      toast.success(L(`Shipment ${shipment.reference} created`, `تم إنشاء الشحنة ${shipment.reference}`));
      setCargo(''); setWeight(''); setNote(''); setDriverId('');
      onOpenChange(false);
      onCreated(shipment.id);
    } catch (e) {
      toast.error((e as Error).message || L('Could not create the shipment', 'تعذر إنشاء الشحنة'));
    }
  };

  const activeDrivers = drivers.filter((d) => d.active);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><PlusSquare className="h-5 w-5" aria-hidden="true" />{L('New shipment', 'شحنة جديدة')}</DialogTitle>
          <DialogDescription>{L('From Egypt to Qatar. The driver photographs the truck’s temperature screen along the way.', 'من مصر إلى قطر. يصوّر السائق شاشة حرارة الشاحنة أثناء الرحلة.')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ship-cargo">{L('Cargo', 'الشحنة')}</Label>
            <Input id="ship-cargo" value={cargo} maxLength={200} onChange={(e) => setCargo(e.target.value)} placeholder={L('e.g. Frozen chicken, 240 cartons', 'مثال: دجاج مجمد، 240 كرتونة')} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ship-weight">{L('Weight (tons)', 'الوزن (طن)')}</Label>
              <Input id="ship-weight" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="18.4" dir="ltr" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ship-interval">{L('Photo every', 'صورة كل')}</Label>
              <select id="ship-interval" className={selectClass} value={interval} onChange={(e) => setIntervalHours(Number(e.target.value))}>
                {INTERVALS.map((h) => <option key={h} value={h}>{lang === 'ar' ? `${h} ساعة` : `${h} h`}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ship-target">{L('Target temperature (°C)', 'درجة الحرارة المطلوبة (°م)')}</Label>
              <div className="flex gap-2">
                <Input id="ship-target" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} dir="ltr" />
                <Button type="button" variant="outline" size="icon" onClick={() => setTarget((v) => toggleSign(v))} aria-label={L('Switch between plus and minus', 'تبديل بين الموجب والسالب')}>±</Button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ship-tol">{L('Allowed ± (°C)', 'السماح ± (°م)')}</Label>
              <Input id="ship-tol" inputMode="decimal" value={tolerance} onChange={(e) => setTolerance(e.target.value)} dir="ltr" />
            </div>
          </div>
          <p className="-mt-2 text-xs text-muted-foreground">
            {L('A reading outside the allowed range alerts you straight away.', 'أي قراءة خارج النطاق المسموح تنبّهك فوراً.')}
          </p>

          <div className="space-y-1.5">
            <Label htmlFor="ship-driver">{L('Driver', 'السائق')}</Label>
            <select id="ship-driver" className={selectClass} value={driverId} onChange={(e) => setDriverId(e.target.value)}>
              <option value="">{L('Assign later', 'تعيين لاحقاً')}</option>
              {activeDrivers.map((d) => <option key={d.id} value={d.id}>{d.display_name}{d.truck_plate ? ` · ${d.truck_plate}` : ''}</option>)}
            </select>
            {activeDrivers.length === 0 && (
              <button type="button" onClick={onManageDrivers} className="text-xs font-semibold text-primary underline-offset-2 hover:underline">
                {L('You have no drivers yet — add one', 'ليس لديك سائقون بعد — أضف سائقاً')}
              </button>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ship-note">{L('Note (optional)', 'ملاحظة (اختياري)')}</Label>
            <Input id="ship-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>

          <div className="rounded-xl border border-border bg-muted/40 p-3">
            <div className="mb-1.5 text-xs font-semibold text-muted-foreground">{L('Route', 'المسار')}</div>
            <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
              {FIXED_ROUTE.map((s, i) => (
                <li key={s.nameEn} className="flex items-center gap-1.5">
                  {i > 0 && <span aria-hidden="true" className="text-muted-foreground">›</span>}
                  <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3 text-muted-foreground" aria-hidden="true" />{lang === 'ar' ? s.nameAr : s.nameEn}</span>
                </li>
              ))}
            </ol>
            <p className="mt-1.5 text-xs text-muted-foreground">{L('The driver can add extra stops on the way.', 'يمكن للسائق إضافة محطات إضافية في الطريق.')}</p>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={create.isPending}>{L('Cancel', 'إلغاء')}</Button>
          <Button onClick={submit} disabled={create.isPending}>
            {create.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden="true" />}
            {L('Dispatch shipment', 'إرسال الشحنة')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
