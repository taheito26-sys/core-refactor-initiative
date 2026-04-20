import { useState } from 'react';
import { useAuth } from '@/features/auth/auth-context';
import { useTheme } from '@/lib/theme-context';
import { Loader2, LogOut } from 'lucide-react';
import { toast } from 'sonner';
import { CUSTOMER_COUNTRIES, updateCustomerProfile } from '@/features/customer/customer-portal';

export default function CustomerSettingsPage() {
  const { customerProfile, userId, refreshProfile, logout, email } = useAuth();
  const { settings } = useTheme();
  const lang = settings.language === 'ar' ? 'ar' : 'en';

  const [displayName, setDisplayName] = useState(customerProfile?.display_name ?? '');
  const [phone,       setPhone]       = useState(customerProfile?.phone ?? '');
  const [country,     setCountry]     = useState(customerProfile?.country ?? CUSTOMER_COUNTRIES[0]);
  const [saving,      setSaving]      = useState(false);

  const save = async () => {
    if (!userId || !displayName.trim()) {
      toast.error(lang === 'ar' ? 'الاسم مطلوب' : 'Name is required');
      return;
    }
    setSaving(true);
    try {
      const { error } = await updateCustomerProfile(userId, {
        display_name: displayName.trim(),
        phone: phone.trim() || null,
        country,
      });
      if (error) throw error;
      await refreshProfile();
      toast.success(lang === 'ar' ? 'تم الحفظ' : 'Saved');
    } catch (e: any) {
      toast.error(e?.message ?? (lang === 'ar' ? 'فشل الحفظ' : 'Save failed'));
    } finally {
      setSaving(false);
    }
  };

  const L = (en: string, ar: string) => lang === 'ar' ? ar : en;

  return (
    <div className="space-y-5">
      <h1 className="text-lg font-bold">{L('Settings', 'الإعدادات')}</h1>

      {/* Account card */}
      <div className="rounded-2xl border border-border/50 bg-card px-4 py-3 flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
          {(customerProfile?.display_name?.[0] ?? email?.[0] ?? 'C').toUpperCase()}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground truncate">{customerProfile?.display_name ?? '—'}</p>
          <p className="text-xs text-muted-foreground truncate">{email}</p>
        </div>
      </div>

      {/* Profile form */}
      <div className="rounded-2xl border border-border/50 bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border/40">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{L('Profile', 'الملف الشخصي')}</p>
        </div>
        <div className="px-4 py-4 space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{L('Name', 'الاسم')}</label>
            <input
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              className="h-10 w-full rounded-xl border border-border/50 bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{L('Phone', 'الهاتف')}</label>
            <input
              value={phone}
              onChange={e => setPhone(e.target.value)}
              type="tel"
              className="h-10 w-full rounded-xl border border-border/50 bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{L('Country', 'البلد')}</label>
            <select
              value={country}
              onChange={e => setCountry(e.target.value as any)}
              className="h-10 w-full rounded-xl border border-border/50 bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30"
            >
              {CUSTOMER_COUNTRIES.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <button
            onClick={save}
            disabled={saving}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {L('Save', 'حفظ')}
          </button>
        </div>
      </div>

      {/* Sign out */}
      <button
        onClick={() => logout()}
        className="flex w-full items-center justify-center gap-2 rounded-2xl border border-destructive/30 bg-destructive/5 py-3 text-sm font-semibold text-destructive transition-colors hover:bg-destructive/10"
      >
        <LogOut className="h-4 w-4" />
        {L('Sign out', 'تسجيل خروج')}
      </button>
    </div>
  );
}
