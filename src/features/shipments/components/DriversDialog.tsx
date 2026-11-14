import { useState } from 'react';
import { Loader2, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useCreateDriver, useDrivers, useSetDriverActive } from '../hooks';
import type { Lang } from '../route';

const EMPTY = { displayName: '', username: '', password: '', phone: '', truckPlate: '' };

/** The customer's drivers: add one with a login, and switch a driver off without losing their history. */
export function DriversDialog({ open, onOpenChange, lang }: { open: boolean; onOpenChange: (open: boolean) => void; lang: Lang }) {
  const L = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const { data: drivers = [], isLoading } = useDrivers();
  const createDriver = useCreateDriver();
  const setActive = useSetDriverActive();
  const [form, setForm] = useState(EMPTY);
  const [created, setCreated] = useState<{ username: string; password: string } | null>(null);
  const set = (key: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async () => {
    if (!form.displayName.trim()) return toast.error(L('Enter the driver’s name', 'أدخل اسم السائق'));
    try {
      await createDriver.mutateAsync({ ...form, username: form.username.trim().toLowerCase() });
      setCreated({ username: form.username.trim().toLowerCase(), password: form.password });
      setForm(EMPTY);
    } catch (e) {
      toast.error((e as Error).message || L('Could not add the driver', 'تعذر إضافة السائق'));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setCreated(null); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
        <DialogHeader>
          <DialogTitle>{L('Your drivers', 'سائقوك')}</DialogTitle>
          <DialogDescription>{L('Each driver signs in with their own username and password to send temperature photos.', 'يسجّل كل سائق الدخول باسم مستخدم وكلمة مرور خاصة به لإرسال صور الحرارة.')}</DialogDescription>
        </DialogHeader>

        {created && (
          <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm" role="status">
            <div className="font-semibold">{L('Driver added. Give them these sign-in details:', 'تمت إضافة السائق. سلّمه بيانات الدخول التالية:')}</div>
            <div className="mt-1 space-y-0.5 text-xs" dir="ltr">
              <div>{L('Username', 'اسم المستخدم')}: <b>{created.username}</b></div>
              <div>{L('Password', 'كلمة المرور')}: <b>{created.password}</b></div>
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">{L('The password is not shown again.', 'لن تظهر كلمة المرور مرة أخرى.')}</div>
          </div>
        )}

        <div className="space-y-2">
          {isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Loading" />}
          {!isLoading && drivers.length === 0 && <p className="text-sm text-muted-foreground">{L('No drivers yet.', 'لا يوجد سائقون بعد.')}</p>}
          {drivers.map((d) => (
            <div key={d.id} className="flex items-center justify-between gap-3 rounded-xl border border-border p-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{d.display_name}</div>
                <div className="truncate text-[11px] text-muted-foreground" dir="ltr">
                  {d.username}{d.truck_plate ? ` · ${d.truck_plate}` : ''}{d.phone ? ` · ${d.phone}` : ''}
                </div>
              </div>
              <label className="flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
                {d.active ? L('Active', 'نشط') : L('Off', 'متوقف')}
                <Switch
                  checked={d.active}
                  disabled={setActive.isPending}
                  onCheckedChange={(active) => setActive.mutate({ driverId: d.id, active }, { onError: (e) => toast.error((e as Error).message) })}
                  aria-label={L(`Switch ${d.display_name} on or off`, `تشغيل أو إيقاف ${d.display_name}`)}
                />
              </label>
            </div>
          ))}
        </div>

        <div className="space-y-3 border-t border-border pt-4">
          <div className="flex items-center gap-2 text-sm font-semibold"><UserPlus className="h-4 w-4" aria-hidden="true" />{L('Add a driver', 'إضافة سائق')}</div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label htmlFor="drv-name">{L('Name', 'الاسم')}</Label><Input id="drv-name" value={form.displayName} onChange={set('displayName')} maxLength={80} /></div>
            <div className="space-y-1.5"><Label htmlFor="drv-plate">{L('Truck plate', 'رقم الشاحنة')}</Label><Input id="drv-plate" value={form.truckPlate} onChange={set('truckPlate')} dir="ltr" /></div>
            <div className="space-y-1.5"><Label htmlFor="drv-user">{L('Username', 'اسم المستخدم')}</Label><Input id="drv-user" value={form.username} onChange={set('username')} autoCapitalize="none" autoCorrect="off" dir="ltr" /></div>
            <div className="space-y-1.5"><Label htmlFor="drv-pass">{L('Password (8+)', 'كلمة المرور (8+)')}</Label><Input id="drv-pass" type="text" value={form.password} onChange={set('password')} autoComplete="off" dir="ltr" /></div>
            <div className="col-span-2 space-y-1.5"><Label htmlFor="drv-phone">{L('Phone (optional)', 'الهاتف (اختياري)')}</Label><Input id="drv-phone" inputMode="tel" value={form.phone} onChange={set('phone')} dir="ltr" /></div>
          </div>
          <Button onClick={submit} disabled={createDriver.isPending} className="w-full">
            {createDriver.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden="true" />}
            {L('Add driver', 'إضافة السائق')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
