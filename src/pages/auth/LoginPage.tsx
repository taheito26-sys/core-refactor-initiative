import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/features/auth/auth-context';
import { useT } from '@/lib/i18n';
import { useTheme } from '@/lib/theme-context';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Loader2, Shield, Store, User } from 'lucide-react';
import { toast } from 'sonner';

type PortalRole = 'merchant' | 'customer';

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [selectedRole, setSelectedRole] = useState<PortalRole | null>(null);
  const { loginWithGoogle, devLogin, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const t = useT();
  const { settings, update } = useTheme();

  useEffect(() => {
    if (isAuthenticated) {
      navigate('/dashboard', { replace: true });
    }
  }, [isAuthenticated, navigate]);

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(regs => {
        regs.forEach(r => r.update().catch(() => {}));
      });
    }
  }, []);

  const handleGoogleLogin = async () => {
    if (!selectedRole) {
      toast.error(t.isRTL ? 'اختر البوابة أولاً' : 'Please select a portal first');
      return;
    }
    localStorage.setItem('p2p_signup_role', selectedRole);
    setLoading(true);
    try {
      await loginWithGoogle();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : (t('googleSignInFailed') || 'Google sign-in failed');
      toast.error(message);
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen" dir={t.isRTL ? 'rtl' : 'ltr'}>
      {/* ── Desktop Left Panel ── */}
      <div className="hidden lg:flex lg:w-[55%] relative overflow-hidden">
        <div className="absolute inset-0 bg-[#0a0a0f]" />
        <div className="absolute inset-0" style={{
          background: `
            radial-gradient(ellipse 80% 60% at 20% 80%, rgba(212,175,55,0.12), transparent),
            radial-gradient(ellipse 60% 50% at 80% 20%, rgba(212,175,55,0.06), transparent)
          `,
        }} />
        <div className="absolute inset-0 opacity-[0.03]" style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
        }} />

        <div className="relative z-10 flex flex-col justify-between p-12 w-full">
          <div className="flex items-center gap-3">
            <img src="/favicon.png" alt="Tracker" className="h-12 w-12 rounded-xl shadow-lg" />
            <div>
              <div className="text-white font-black text-lg tracking-tight">TRACKER</div>
              <div className="text-[#d4af37] text-[10px] font-semibold uppercase tracking-[0.2em]">P2P Intelligence</div>
            </div>
          </div>

          <div className="space-y-6">
            <div>
              <h1 className="text-4xl font-black text-white leading-[1.1] tracking-tight">
                {t('qatarPowered')}
              </h1>
              <p className="text-white/50 text-base mt-4 max-w-md leading-relaxed">
                {t('trustedByMerchants')}
              </p>
            </div>

            <div className="max-w-md space-y-3 pt-2">
              <p className="text-[10px] font-semibold text-[#d4af37] uppercase tracking-[0.15em]">
                {t.isRTL ? 'اختر البوابة' : 'Choose your portal'}
              </p>
              <div className="grid grid-cols-2 gap-3">
                <button type="button" onClick={() => setSelectedRole('merchant')}
                  className={cn(
                    'flex flex-col items-center gap-2 rounded-xl border p-5 transition-all duration-200',
                    selectedRole === 'merchant'
                      ? 'border-[#d4af37] bg-[#d4af37]/10 shadow-lg shadow-[#d4af37]/10'
                      : 'border-white/[0.08] bg-white/[0.03] hover:border-white/[0.15] hover:bg-white/[0.05]'
                  )}>
                  <div className={cn('flex h-10 w-10 items-center justify-center rounded-lg', selectedRole === 'merchant' ? 'bg-[#d4af37]/20' : 'bg-white/[0.06]')}>
                    <Store className={cn('h-5 w-5', selectedRole === 'merchant' ? 'text-[#d4af37]' : 'text-white/40')} />
                  </div>
                  <span className={cn('text-sm font-bold', selectedRole === 'merchant' ? 'text-[#d4af37]' : 'text-white/60')}>
                    {t.isRTL ? 'تاجر' : 'Merchant'}
                  </span>
                  <span className="text-[10px] text-white/30 text-center">{t.isRTL ? 'تداول وإدارة المخزون' : 'Trade & manage stock'}</span>
                </button>
                <button type="button" onClick={() => setSelectedRole('customer')}
                  className={cn(
                    'flex flex-col items-center gap-2 rounded-xl border p-5 transition-all duration-200',
                    selectedRole === 'customer'
                      ? 'border-[#d4af37] bg-[#d4af37]/10 shadow-lg shadow-[#d4af37]/10'
                      : 'border-white/[0.08] bg-white/[0.03] hover:border-white/[0.15] hover:bg-white/[0.05]'
                  )}>
                  <div className={cn('flex h-10 w-10 items-center justify-center rounded-lg', selectedRole === 'customer' ? 'bg-[#d4af37]/20' : 'bg-white/[0.06]')}>
                    <User className={cn('h-5 w-5', selectedRole === 'customer' ? 'text-[#d4af37]' : 'text-white/40')} />
                  </div>
                  <span className={cn('text-sm font-bold', selectedRole === 'customer' ? 'text-[#d4af37]' : 'text-white/60')}>
                    {t.isRTL ? 'عميل' : 'Customer'}
                  </span>
                  <span className="text-[10px] text-white/30 text-center">{t.isRTL ? 'شراء وبيع مع التجار' : 'Buy & sell with merchants'}</span>
                </button>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex gap-1">
              <div className="w-1.5 h-6 rounded-full bg-[#d4af37]" />
              <div className="w-1.5 h-6 rounded-full bg-white/80" />
            </div>
            <span className="text-[10px] text-white/30 font-semibold uppercase tracking-[0.15em]">
              {t.isRTL ? 'صُنع في قطر 🇶🇦' : 'Made in Qatar 🇶🇦'}
            </span>
          </div>
        </div>
      </div>

      {/* ── Right Panel (Desktop) / Full Screen (Mobile) ── */}
      <div className="flex-1 relative overflow-hidden">
        {/* Mobile: dark gradient background */}
        <div className="absolute inset-0 lg:hidden bg-[#0a0a0f]" />
        <div className="absolute inset-0 lg:hidden" style={{
          background: `
            radial-gradient(ellipse 120% 80% at 50% 0%, rgba(212,175,55,0.08), transparent 60%),
            radial-gradient(ellipse 80% 60% at 50% 100%, rgba(212,175,55,0.04), transparent 60%)
          `,
        }} />
        <div className="absolute inset-0 lg:hidden opacity-[0.025]" style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
        }} />

        {/* Desktop: normal bg */}
        <div className="absolute inset-0 hidden lg:block bg-background" />

        <div className="relative z-10 flex flex-col min-h-screen">
          {/* Language Toggle */}
          <div className="flex justify-end p-4">
            <div className="flex items-center gap-0.5 rounded-full p-0.5 shadow-sm bg-white/[0.06] lg:bg-muted">
              <button onClick={() => update({ language: 'ar' })}
                className={cn(
                  'px-3 py-1.5 rounded-full text-[11px] font-semibold transition-all',
                  settings.language === 'ar'
                    ? 'bg-[#d4af37] text-black lg:bg-primary lg:text-primary-foreground shadow-sm'
                    : 'text-white/50 hover:text-white/80 lg:text-muted-foreground lg:hover:text-foreground'
                )}>عربي</button>
              <button onClick={() => update({ language: 'en' })}
                className={cn(
                  'px-3 py-1.5 rounded-full text-[11px] font-semibold transition-all',
                  settings.language === 'en'
                    ? 'bg-[#d4af37] text-black lg:bg-primary lg:text-primary-foreground shadow-sm'
                    : 'text-white/50 hover:text-white/80 lg:text-muted-foreground lg:hover:text-foreground'
                )}>EN</button>
            </div>
          </div>

          {/* Main Content */}
          <div className="flex-1 flex flex-col items-center justify-center px-6 pb-8 lg:px-12">
            <div className="w-full max-w-sm space-y-8">

              {/* Mobile: Logo + Branding */}
              <div className="lg:hidden flex flex-col items-center gap-4">
                <img src="/favicon.png" alt="Tracker" className="h-20 w-20 rounded-2xl shadow-2xl shadow-[#d4af37]/20" />
                <div className="text-center">
                  <div className="text-2xl font-black text-white tracking-tight">TRACKER</div>
                  <div className="text-[10px] text-[#d4af37] font-semibold uppercase tracking-[0.25em] mt-1">P2P Intelligence</div>
                </div>
                <h1 className="text-lg font-bold text-white/70 text-center mt-2 leading-snug">
                  {t('qatarPowered')}
                </h1>
              </div>

              {/* Desktop: Welcome text */}
              <div className="hidden lg:block text-start">
                <h2 className="text-2xl font-black text-foreground tracking-tight">{t('welcomeBack')}</h2>
                <p className="text-sm text-muted-foreground mt-1">{t('secureTrading')}</p>
              </div>

              {/* Mobile: Portal Selector */}
              <div className="lg:hidden space-y-3">
                <p className="text-[10px] font-semibold text-[#d4af37] uppercase tracking-[0.15em] text-center">
                  {t.isRTL ? 'اختر البوابة' : 'Choose your portal'}
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <button type="button" onClick={() => setSelectedRole('merchant')}
                    className={cn(
                      'flex flex-col items-center gap-2.5 rounded-xl border p-4 transition-all duration-200',
                      selectedRole === 'merchant'
                        ? 'border-[#d4af37] bg-[#d4af37]/10 shadow-lg shadow-[#d4af37]/10'
                        : 'border-white/[0.08] bg-white/[0.03] hover:border-white/[0.12]'
                    )}>
                    <div className={cn('flex h-10 w-10 items-center justify-center rounded-lg', selectedRole === 'merchant' ? 'bg-[#d4af37]/20' : 'bg-white/[0.06]')}>
                      <Store className={cn('h-5 w-5', selectedRole === 'merchant' ? 'text-[#d4af37]' : 'text-white/40')} />
                    </div>
                    <span className={cn('text-sm font-bold', selectedRole === 'merchant' ? 'text-[#d4af37]' : 'text-white/60')}>
                      {t.isRTL ? 'تاجر' : 'Merchant'}
                    </span>
                  </button>
                  <button type="button" onClick={() => setSelectedRole('customer')}
                    className={cn(
                      'flex flex-col items-center gap-2.5 rounded-xl border p-4 transition-all duration-200',
                      selectedRole === 'customer'
                        ? 'border-[#d4af37] bg-[#d4af37]/10 shadow-lg shadow-[#d4af37]/10'
                        : 'border-white/[0.08] bg-white/[0.03] hover:border-white/[0.12]'
                    )}>
                    <div className={cn('flex h-10 w-10 items-center justify-center rounded-lg', selectedRole === 'customer' ? 'bg-[#d4af37]/20' : 'bg-white/[0.06]')}>
                      <User className={cn('h-5 w-5', selectedRole === 'customer' ? 'text-[#d4af37]' : 'text-white/40')} />
                    </div>
                    <span className={cn('text-sm font-bold', selectedRole === 'customer' ? 'text-[#d4af37]' : 'text-white/60')}>
                      {t.isRTL ? 'عميل' : 'Customer'}
                    </span>
                  </button>
                </div>
              </div>

              {/* Google Sign In */}
              <Button type="button"
                className={cn(
                  'w-full h-12 text-sm font-semibold gap-3 rounded-xl shadow-sm',
                  'lg:bg-primary lg:text-primary-foreground',
                  'max-lg:bg-white max-lg:text-black max-lg:hover:bg-white/90'
                )}
                size="lg" onClick={handleGoogleLogin} disabled={loading || !selectedRole}>
                {loading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <svg className="h-5 w-5" viewBox="0 0 24 24">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                )}
                {t('continueWithGoogle')}
              </Button>

              {/* Security */}
              <div className="flex items-center justify-center gap-2 text-[10px] text-white/30 lg:text-muted-foreground/60">
                <Shield className="h-3 w-3" />
                <span>{t.isRTL ? 'محمي بتشفير المؤسسات' : 'Protected by enterprise-grade encryption'}</span>
              </div>
            </div>
          </div>

          {/* Mobile Footer */}
          <div className="lg:hidden flex items-center justify-center gap-2 pb-6">
            <div className="flex gap-1">
              <div className="w-1.5 h-4 rounded-full bg-[#d4af37]/60" />
              <div className="w-1.5 h-4 rounded-full bg-white/40" />
            </div>
            <span className="text-[10px] text-white/25 font-semibold uppercase tracking-[0.15em]">
              {t.isRTL ? 'صُنع في قطر 🇶🇦' : 'Made in Qatar 🇶🇦'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
