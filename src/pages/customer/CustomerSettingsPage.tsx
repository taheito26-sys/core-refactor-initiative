import { useState } from 'react';
import { useAuth } from '@/features/auth/auth-context';
import { useTheme, LAYOUTS, THEME_NAMES } from '@/lib/theme-context';
import { resolveThemeForLayout } from '@/lib/theme/utils';
import { Loader2, LogOut, Bell, Globe, User, ChevronRight, Check, Palette } from 'lucide-react';
import { toast } from 'sonner';
import { CUSTOMER_COUNTRIES, updateCustomerProfile, resolveCustomerDisplayName } from '@/features/customer/customer-portal';

export default function CustomerSettingsPage() {
  const { customerProfile, userId, refreshProfile, logout, email } = useAuth();
  const { settings, update, currentLayout } = useTheme();
  const lang = settings.language === 'ar' ? 'ar' : 'en';
  const L = (en: string, ar: string) => lang === 'ar' ? ar : en;
  const [displayName,   setDisplayName]   = useState(customerProfile?.display_name ?? '');
  const [displayNameAr, setDisplayNameAr] = useState(customerProfile?.display_name_ar ?? '');
  const [phone,       setPhone]       = useState(customerProfile?.phone ?? '');
  const [country,     setCountry]     = useState(customerProfile?.country ?? CUSTOMER_COUNTRIES[0]);
  const [saving,      setSaving]      = useState(false);
  const resolvedName = resolveCustomerDisplayName(customerProfile, lang);

  const save = async () => {
    if (!userId || !displayName.trim()) { toast.error(L('Name is required', 'الاسم مطلوب')); return; }
    setSaving(true);
    try {
      const { error } = await updateCustomerProfile(userId, {
        display_name: displayName.trim(),
        display_name_ar: displayNameAr.trim() || null,
        phone: phone.trim() || null,
        country,
      });
      if (error) throw error;
      await refreshProfile();
      toast.success(L('Saved', 'تم الحفظ'));
    } catch (e: any) { toast.error(e?.message ?? L('Save failed', 'فشل الحفظ')); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-5">
      <h1 className="text-lg font-bold">{L('Settings', 'الإعدادات')}</h1>

      {/* Account card */}
      <div className="flex items-center gap-3 rounded-2xl border border-border/50 bg-card px-4 py-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-lg font-bold text-primary">
          {(resolvedName?.[0] ?? email?.[0] ?? 'C').toUpperCase()}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold truncate">{resolvedName ?? '—'}</p>
          <p className="text-xs text-muted-foreground truncate">{email}</p>
        </div>
      </div>

      {/* Profile */}
      <div className="rounded-2xl border border-border/50 bg-card overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border/40">
          <User className="h-4 w-4 text-muted-foreground" />
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{L('Profile', 'الملف الشخصي')}</p>
        </div>
        <div className="px-4 py-4 space-y-4">
          {[
            { label: L('Name (English)', 'الاسم (إنجليزي)'), value: displayName, set: setDisplayName, type: 'text', placeholder: L('Your name', 'اسمك'), dir: 'ltr' as const },
            { label: L('Name (Arabic)', 'الاسم (عربي)'), value: displayNameAr, set: setDisplayNameAr, type: 'text', placeholder: 'اسمك بالعربية', dir: 'rtl' as const },
            { label: L('Phone', 'الهاتف'), value: phone, set: setPhone, type: 'tel', placeholder: '+974…', dir: 'ltr' as const },
          ].map(({ label, value, set, type, placeholder, dir }) => (
            <div key={label}>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</label>
              <input value={value} onChange={e => set(e.target.value)} type={type} placeholder={placeholder} dir={dir} className="h-11 w-full rounded-xl border border-border/50 bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
          ))}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{L('Country', 'البلد')}</label>
            <select value={country} onChange={e => setCountry(e.target.value as any)} className="h-11 w-full rounded-xl border border-border/50 bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30">
              {CUSTOMER_COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <button onClick={save} disabled={saving} className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-bold text-primary-foreground disabled:opacity-60">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}{L('Save changes', 'حفظ التغييرات')}
          </button>
        </div>
      </div>

      {/* Appearance — the same layouts and colour themes the merchant app
          offers, driven by the one shared ThemeProvider. */}
      <div className="rounded-2xl border border-border/50 bg-card overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border/40">
          <Palette className="h-4 w-4 text-muted-foreground" />
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{L('Appearance', 'المظهر')}</p>
          <span className="ms-auto text-[10px] text-muted-foreground truncate">{currentLayout.name}</span>
        </div>

        <div className="px-4 py-4 space-y-4">
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">{L('Layout', 'التخطيط')}</p>
            <div className="grid grid-cols-2 gap-2">
              {LAYOUTS.map(l => (
                <button
                  key={l.id}
                  onClick={() => update({ layout: l.id, theme: resolveThemeForLayout(l.id, settings.theme) })}
                  className={`relative rounded-xl border p-2.5 text-start transition-colors ${settings.layout === l.id ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border/50 hover:border-primary/40'}`}
                >
                  {settings.layout === l.id && (
                    <span className="absolute top-1.5 end-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary">
                      <Check className="h-2.5 w-2.5 text-primary-foreground" />
                    </span>
                  )}
                  <span className="block text-[11px] font-bold truncate pe-4">{l.name}</span>
                  <span className="block text-[9px] text-muted-foreground truncate">{l.desc}</span>
                  <span className="mt-1.5 flex gap-0.5">
                    {l.swatches.map((c, i) => (
                      <span key={i} className="h-2.5 w-2.5 rounded-sm" style={{ background: c }} />
                    ))}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">{L('Colour theme', 'لون السمة')}</p>
            <div className="grid grid-cols-3 gap-2">
              {Object.entries(currentLayout.themes).map(([tid, themeDef]) => (
                <button
                  key={tid}
                  onClick={() => update({ theme: tid })}
                  className={`rounded-xl border p-2 transition-colors ${settings.theme === tid ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border/50 hover:border-primary/40'}`}
                >
                  <span className="mb-1 flex gap-0.5">
                    <span className="h-5 w-5 rounded-sm border border-border/50" style={{ background: themeDef.bg }} />
                    <span className="h-5 w-5 rounded-sm" style={{ background: themeDef.panel }} />
                    {[themeDef.brand, themeDef.brand2, themeDef.good, themeDef.bad].map((c, i) => (
                      <span key={i} className="h-5 flex-1 rounded-sm" style={{ background: c }} />
                    ))}
                  </span>
                  <span className="block text-center text-[10px] font-medium">{THEME_NAMES[tid] || tid}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Language */}
      <div className="rounded-2xl border border-border/50 bg-card overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border/40">
          <Globe className="h-4 w-4 text-muted-foreground" />
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{L('Language', 'اللغة')}</p>
        </div>
        <div className="flex gap-1 p-3">
          {(['en', 'ar'] as const).map(l => (
            <button key={l} onClick={() => update({ language: l })} className={`flex-1 rounded-xl py-2.5 text-sm font-semibold transition-colors ${settings.language === l ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
              {l === 'en' ? 'English' : 'العربية'}
            </button>
          ))}
        </div>
      </div>

      {/* FX preferences */}
      <div className="rounded-2xl border border-border/50 bg-card overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border/40">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{L('FX Preferences', 'تفضيلات الصرف')}</p>
        </div>
        <div className="px-4 py-3 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">{L('Default corridor', 'المسار الافتراضي')}</span>
            <span className="font-semibold">QAR → EGP</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">{L('Preferred currency', 'العملة المفضلة')}</span>
            <span className="font-semibold">{customerProfile?.preferred_currency ?? 'USDT'}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">{L('Member since', 'عضو منذ')}</span>
            <span>{customerProfile?.created_at ? new Date(customerProfile.created_at).toLocaleDateString() : '—'}</span>
          </div>
        </div>
      </div>

      {/* Sign out */}
      <button onClick={() => logout()} className="flex w-full items-center justify-center gap-2 rounded-2xl border border-destructive/30 bg-destructive/5 py-3 text-sm font-semibold text-destructive hover:bg-destructive/10 transition-colors">
        <LogOut className="h-4 w-4" />{L('Sign out', 'تسجيل خروج')}
      </button>
    </div>
  );
}
