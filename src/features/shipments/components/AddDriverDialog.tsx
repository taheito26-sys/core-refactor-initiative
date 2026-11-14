import { useState } from 'react';
import { CheckCircle2, Loader2, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useCreateDriver } from '../hooks';
import type { Lang } from '../route';
import '@/styles/customer-home.css';
import '@/styles/customer-orders.css';
import '@/styles/customer-theme.css';
import '@/styles/customer-shipments.css';

const EMPTY = { displayName: '', username: '', password: '', phone: '', truckPlate: '' };

/** Adds a driver with a login of their own. Everything else about drivers (state, numbers, switching off) lives on the Drivers tab. */
export function AddDriverDialog({ open, onOpenChange, lang }: { open: boolean; onOpenChange: (open: boolean) => void; lang: Lang }) {
  const L = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const createDriver = useCreateDriver();
  const [form, setForm] = useState(EMPTY);
  const [created, setCreated] = useState<{ username: string; password: string } | null>(null);
  const set = (key: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async () => {
    if (!form.displayName.trim()) return toast.error(L('Enter the driver’s name', 'أدخل اسم السائق'));
    try {
      const username = form.username.trim().toLowerCase();
      await createDriver.mutateAsync({ ...form, username });
      setCreated({ username, password: form.password });
      setForm(EMPTY);
    } catch (e) {
      toast.error((e as Error).message || L('Could not add the driver', 'تعذر إضافة السائق'));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setCreated(null); }}>
      <DialogContent className="cs-dialog sm:max-w-md" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
        <div className="ch-root cs-form" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
          <DialogTitle asChild><h2>{L('Add a driver', 'إضافة سائق')}</h2></DialogTitle>
          <DialogDescription asChild><p>{L('Each driver signs in with their own username and password to send temperature photos.', 'يسجّل كل سائق الدخول باسم مستخدم وكلمة مرور خاصة به لإرسال صور الحرارة.')}</p></DialogDescription>

          {created && (
            <div className="cs-banner ok" role="status">
              <CheckCircle2 aria-hidden="true" />
              <div>
                <b>{L('Driver added. Give them these sign-in details:', 'تمت إضافة السائق. سلّمه بيانات الدخول التالية:')}</b>
                <div className="cs-secret">
                  <span>{L('Username', 'اسم المستخدم')}: <b style={{ display: 'inline' }}>{created.username}</b></span>
                  <span>{L('Password', 'كلمة المرور')}: <b style={{ display: 'inline' }}>{created.password}</b></span>
                </div>
                <div style={{ marginTop: 4 }}>{L('The password is not shown again.', 'لن تظهر كلمة المرور مرة أخرى.')}</div>
              </div>
            </div>
          )}

          <div className="cs-grid2">
            <div className="cs-field"><label htmlFor="drv-name">{L('Name', 'الاسم')}</label><input id="drv-name" value={form.displayName} onChange={set('displayName')} maxLength={80} /></div>
            <div className="cs-field"><label htmlFor="drv-plate">{L('Truck plate', 'رقم الشاحنة')}</label><input id="drv-plate" value={form.truckPlate} onChange={set('truckPlate')} dir="ltr" /></div>
            <div className="cs-field"><label htmlFor="drv-user">{L('Username', 'اسم المستخدم')}</label><input id="drv-user" value={form.username} onChange={set('username')} autoCapitalize="none" autoCorrect="off" dir="ltr" /></div>
            <div className="cs-field"><label htmlFor="drv-pass">{L('Password (8+)', 'كلمة المرور (8+)')}</label><input id="drv-pass" type="text" value={form.password} onChange={set('password')} autoComplete="off" dir="ltr" /></div>
            <div className="cs-field" style={{ gridColumn: '1 / -1' }}><label htmlFor="drv-phone">{L('Phone (optional)', 'الهاتف (اختياري)')}</label><input id="drv-phone" inputMode="tel" value={form.phone} onChange={set('phone')} dir="ltr" /></div>
          </div>
          <button type="button" className="cs-cta" onClick={submit} disabled={createDriver.isPending}>
            {createDriver.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <UserPlus aria-hidden="true" />}
            {L('Add driver', 'إضافة السائق')}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
