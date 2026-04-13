import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/features/auth/auth-context';
import { useT } from '@/lib/i18n';
import { useTheme } from '@/lib/theme-context';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Loader2, TrendingUp, BarChart3, Shield, Zap, Users } from 'lucide-react';
import { toast } from 'sonner';

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const { loginWithGoogle, devLogin, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const t = useT();
  const { settings, update } = useTheme();

  // Redirect to dashboard if already authenticated
  useEffect(() => {
    if (isAuthenticated) {
      navigate('/dashboard', { replace: true });
    }
  }, [isAuthenticated, navigate]);

  // On mount: proactively update stale service workers that cause mobile render failures
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(regs => {
        regs.forEach(r => r.update().catch(() => {}));
      });
    }
  }, []);

  const handleGoogleLogin = async () => {
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
      {/* ── Left Panel: Qatar Culture Hero ── */}
      <div className="hidden lg:flex lg:w-[55%] relative overflow-hidden">
        <div className="absolute inset-0 bg-[hsl(340,30%,8%)]" />
        <div
          className="absolute inset-0"
          style={{
            background: `
              radial-gradient(ellipse 80% 60% at 20% 80%, hsl(340 60% 20% / 0.4), transparent),
              radial-gradient(ellipse 60% 50% at 80% 20%, hsl(35 80% 30% / 0.3), transparent),
              radial-gradient(ellipse 40% 40% at 50% 50%, hsl(0 0% 100% / 0.02), transparent)
            `,
          }}
        />
        <div className="absolute inset-0 opacity-[0.04]" style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
        }} />

        <div className="relative z-10 flex flex-col justify-between p-12 w-full">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-[hsl(35,80%,55%)] to-[hsl(35,70%,40%)] shadow-lg shadow-[hsl(35,80%,55%)]/20">
              <TrendingUp className="h-6 w-6 text-white" />
            </div>
            <div>
              <div className="text-white font-black text-lg tracking-tight">TRACKER</div>
              <div className="text-[hsl(35,60%,65%)] text-[10px] font-semibold uppercase tracking-[0.2em]">P2P Intelligence</div>
            </div>
          </div>

          <div className="space-y-6">
            <div>
              <h1 className="text-4xl font-black text-white leading-[1.1] tracking-tight">
                {t('qatarPowered')}
              </h1>
              <p className="text-[hsl(35,40%,65%)] text-base mt-4 max-w-md leading-relaxed">
                {t('trustedByMerchants')}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 max-w-md">
              {[
                { icon: BarChart3, label: t('liveMarketData') },
                { icon: Shield, label: t('secureMerchantNetwork') },
                { icon: Zap, label: t('smartFifoTracking') },
                { icon: Users, label: t('profitShareAuto') },
              ].map((feat, i) => (
                <div key={i} className="flex items-center gap-2.5 p-3 rounded-lg bg-white/[0.04] border border-white/[0.06]">
                  <feat.icon className="h-4 w-4 text-[hsl(35,80%,60%)] shrink-0" />
                  <span className="text-[11px] text-white/70 font-medium leading-tight">{feat.label}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex gap-1">
              <div className="w-1.5 h-6 rounded-full bg-[hsl(340,60%,35%)]" />
              <div className="w-1.5 h-6 rounded-full bg-white/80" />
            </div>
            <span className="text-[10px] text-white/30 font-semibold uppercase tracking-[0.15em]">
              {t.isRTL ? 'صُنع في قطر 🇶🇦' : 'Made in Qatar 🇶🇦'}
            </span>
          </div>
        </div>
      </div>

      {/* ── Right Panel: Sign In ── */}
      <div className="flex-1 flex items-center justify-center bg-background p-6 lg:p-12 relative">
        {/* ── Language Toggle ── */}
        <div className="absolute top-4 right-4 flex items-center gap-0.5 bg-muted rounded-full p-0.5 shadow-sm">
          <button
            onClick={() => update({ language: 'ar' })}
            className={cn(
              'px-3 py-1.5 rounded-full text-[11px] font-semibold transition-all',
              settings.language === 'ar'
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            عربي
          </button>
          <button
            onClick={() => update({ language: 'en' })}
            className={cn(
              'px-3 py-1.5 rounded-full text-[11px] font-semibold transition-all',
              settings.language === 'en'
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            EN
          </button>
        </div>

        <div className="w-full max-w-sm space-y-8">
          <div className="lg:hidden flex flex-col items-center gap-3 mb-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[hsl(35,80%,55%)] to-[hsl(340,50%,35%)] shadow-lg">
              <TrendingUp className="h-7 w-7 text-white" />
            </div>
            <div className="text-center">
              <div className="text-xl font-black text-foreground tracking-tight">TRACKER</div>
              <div className="text-[10px] text-muted-foreground font-semibold uppercase tracking-[0.2em]">P2P Intelligence</div>
            </div>
          </div>

          <div className="text-center lg:text-start">
            <h2 className="text-2xl font-black text-foreground tracking-tight">{t('welcomeBack')}</h2>
            <p className="text-sm text-muted-foreground mt-1">{t('secureTrading')}</p>
          </div>

          <Button
            type="button"
            className="w-full h-12 text-sm font-semibold gap-3 rounded-xl shadow-sm"
            size="lg"
            onClick={handleGoogleLogin}
            disabled={loading}
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

          <div className="flex items-center justify-center gap-2 text-[10px] text-muted-foreground/60">
            <Shield className="h-3 w-3" />
            <span>{t.isRTL ? 'محمي بتشفير المؤسسات' : 'Protected by enterprise-grade encryption'}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
