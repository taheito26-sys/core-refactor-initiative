import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/features/auth/auth-context';
import { useT } from '@/lib/i18n';
import { useTheme } from '@/lib/theme-context';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Loader2, Shield, TrendingUp, Store, User } from 'lucide-react';
import { toast } from 'sonner';

type PortalRole = 'merchant' | 'customer';

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [selectedRole, setSelectedRole] = useState<PortalRole | null>(null);
  const { loginWithGoogle, isAuthenticated } = useAuth();
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
    // Store chosen role so guards route correctly after login
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
    <div
      className="flex min-h-screen flex-col items-center justify-center relative"
      dir={t.isRTL ? 'rtl' : 'ltr'}
      style={{ backgroundColor: '#0a0a0a' }}
    >
      {/* Language Toggle */}
      <div className="absolute top-4 right-4 flex items-center gap-0.5 rounded-full p-0.5" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}>
        <button
          onClick={() => update({ language: 'ar' })}
          className={cn(
            'px-3 py-1.5 rounded-full text-[11px] font-semibold transition-all',
            settings.language === 'ar'
              ? 'bg-[hsl(35,80%,55%)] text-black shadow-sm'
              : 'text-white/50 hover:text-white/80'
          )}
        >
          عربي
        </button>
        <button
          onClick={() => update({ language: 'en' })}
          className={cn(
            'px-3 py-1.5 rounded-full text-[11px] font-semibold transition-all',
            settings.language === 'en'
              ? 'bg-[hsl(35,80%,55%)] text-black shadow-sm'
              : 'text-white/50 hover:text-white/80'
          )}
        >
          EN
        </button>
      </div>

      <div className="w-full max-w-md px-6 space-y-8">
        {/* Logo */}
        <div className="flex flex-col items-center gap-2">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-[hsl(35,80%,55%)] to-[hsl(35,70%,40%)] shadow-lg shadow-[hsl(35,80%,55%)]/20">
            <TrendingUp className="h-6 w-6 text-white" />
          </div>
          <div className="text-center">
            <div className="text-white font-black text-lg tracking-tight">TRACKER</div>
            <div className="text-[hsl(35,60%,65%)] text-[10px] font-semibold uppercase tracking-[0.2em]">P2P Intelligence</div>
          </div>
        </div>

        {/* Heading */}
        <div className={cn("text-start", t.isRTL && "text-right")}>
          <h2 className="text-3xl font-black text-white tracking-tight">
            {t('welcomeBack')}
          </h2>
          <p className="text-sm text-white/50 mt-1">{t('secureTrading')}</p>
        </div>

        {/* Portal Selector */}
        <div className="space-y-3">
          <p className="text-xs font-semibold text-white/40 uppercase tracking-wider">
            {t.isRTL ? 'اختر البوابة' : 'Choose your portal'}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setSelectedRole('merchant')}
              className={cn(
                'flex flex-col items-center gap-2 rounded-xl border-2 p-5 transition-all duration-200',
                selectedRole === 'merchant'
                  ? 'border-[hsl(35,80%,55%)] bg-[hsl(35,80%,55%)]/10 shadow-lg shadow-[hsl(35,80%,55%)]/10'
                  : 'border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.06]'
              )}
            >
              <div className={cn(
                'flex h-10 w-10 items-center justify-center rounded-lg transition-colors',
                selectedRole === 'merchant' ? 'bg-[hsl(35,80%,55%)]/20' : 'bg-white/5'
              )}>
                <Store className={cn(
                  'h-5 w-5 transition-colors',
                  selectedRole === 'merchant' ? 'text-[hsl(35,80%,55%)]' : 'text-white/40'
                )} />
              </div>
              <span className={cn(
                'text-sm font-bold transition-colors',
                selectedRole === 'merchant' ? 'text-[hsl(35,80%,55%)]' : 'text-white/60'
              )}>
                {t.isRTL ? 'تاجر' : 'Merchant'}
              </span>
              <span className="text-[10px] text-white/30 leading-tight text-center">
                {t.isRTL ? 'تداول وإدارة المخزون' : 'Trade & manage stock'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setSelectedRole('customer')}
              className={cn(
                'flex flex-col items-center gap-2 rounded-xl border-2 p-5 transition-all duration-200',
                selectedRole === 'customer'
                  ? 'border-[hsl(35,80%,55%)] bg-[hsl(35,80%,55%)]/10 shadow-lg shadow-[hsl(35,80%,55%)]/10'
                  : 'border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.06]'
              )}
            >
              <div className={cn(
                'flex h-10 w-10 items-center justify-center rounded-lg transition-colors',
                selectedRole === 'customer' ? 'bg-[hsl(35,80%,55%)]/20' : 'bg-white/5'
              )}>
                <User className={cn(
                  'h-5 w-5 transition-colors',
                  selectedRole === 'customer' ? 'text-[hsl(35,80%,55%)]' : 'text-white/40'
                )} />
              </div>
              <span className={cn(
                'text-sm font-bold transition-colors',
                selectedRole === 'customer' ? 'text-[hsl(35,80%,55%)]' : 'text-white/60'
              )}>
                {t.isRTL ? 'عميل' : 'Customer'}
              </span>
              <span className="text-[10px] text-white/30 leading-tight text-center">
                {t.isRTL ? 'شراء وبيع مع التجار' : 'Buy & sell with merchants'}
              </span>
            </button>
          </div>
        </div>

        {/* Google Login Button */}
        <Button
          type="button"
          className={cn(
            'w-full h-12 text-sm font-semibold gap-3 rounded-xl shadow-md transition-all',
            selectedRole
              ? 'bg-[hsl(35,80%,55%)] hover:bg-[hsl(35,80%,48%)] text-black'
              : 'bg-white/10 text-white/30 cursor-not-allowed'
          )}
          size="lg"
          onClick={handleGoogleLogin}
          disabled={loading || !selectedRole}
        >
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

        {/* Security badge */}
        <div className="flex items-center justify-center gap-2 text-[10px] text-white/25">
          <Shield className="h-3 w-3" />
          <span>{t.isRTL ? 'محمي بتشفير المؤسسات' : 'Protected by enterprise-grade encryption'}</span>
        </div>
      </div>
    </div>
  );
}
