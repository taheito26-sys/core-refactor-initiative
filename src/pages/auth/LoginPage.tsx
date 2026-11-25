import { withAuthDeadline } from '@/features/auth/auth-request';
import { loginErrorKey } from '@/features/auth/login-error';
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/features/auth/auth-context';
import { useT } from '@/lib/i18n';
import { useTheme } from '@/lib/theme-context';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Loader2, ScanFace, Shield } from 'lucide-react';
import { toast } from 'sonner';
import {
  describePasskeyError,
  getPasskeyAvailability,
  hasPasskeyEnrollmentHint,
  isPasskeyCancellation,
  signInWithDevicePasskey,
} from '@/features/auth/passkeys';
import {
  getRememberedIdentifier,
  getRememberPreference,
  loadSavedLogin,
  saveLogin,
} from '@/lib/saved-login';

// The synthetic email domain admin-create-customer-login uses for
// username/password customer accounts — the customer only ever sees or
// types their username, this suffix is invisible to them.
const USERNAME_EMAIL_DOMAIN = 'customers.local';

// One field for both kinds of account: a merchant signs in with their real
// email, a customer with the bare username their merchant issued them. An "@"
// is the only thing that distinguishes the two.
function toLoginEmail(identifier: string): string {
  const clean = identifier.trim().toLowerCase();
  return clean.includes('@') ? clean : `${clean}@${USERNAME_EMAIL_DOMAIN}`;
}

export default function LoginPage() {
  const [busy, setBusy] = useState<'password' | 'google' | 'passkey' | null>(null);
  const loading = busy !== null;
  const [username, setUsername] = useState(() => getRememberedIdentifier());
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(() => getRememberPreference());
  const [loginError, setLoginError] = useState('');
  const [passkeyAvailable, setPasskeyAvailable] = useState(false);
  const { login, loginWithGoogle, devLogin, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const t = useT();
  const { settings, update } = useTheme();

  const handleUsernameLogin = async () => {
    if (loading) return;
    const identifier = username.trim();
    if (!identifier || !password) {
      setLoginError(
        t.isRTL
          ? 'أدخل اسم المستخدم أو البريد الإلكتروني وكلمة المرور'
          : 'Enter your username or email and your password',
      );
      return;
    }
    setLoginError('');
    setBusy('password');
    try {
      // No portal is recorded here: where this account belongs is decided from
      // the profiles it actually has, once the session resolves.
      await withAuthDeadline(login(toLoginEmail(identifier), password), 15000);
      // Only after the server accepted the pair, so a typo never replaces the
      // credentials that are known to work.
      void saveLogin(identifier, password, remember);
    } catch (error) {
      setLoginError(t(loginErrorKey(error)));
    } finally {
      setBusy(null);
    }
  };

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

  // Face ID / Touch ID is offered only where the browser reports a usable
  // platform authenticator *and* a passkey was set up from Settings on this
  // device, so the button never leads to an empty credential picker.
  useEffect(() => {
    let alive = true;
    void getPasskeyAvailability().then(result => {
      if (alive) setPasskeyAvailable(result === 'available' && hasPasskeyEnrollmentHint());
    });
    return () => {
      alive = false;
    };
  }, []);

  // iOS never offers its password sheet inside a home-screen web app, so the
  // page restores what the user chose to remember last time.
  useEffect(() => {
    let alive = true;
    loadSavedLogin()
      .then(saved => {
        if (!alive || !saved) return;
        setUsername(current => current || saved.identifier);
        if (saved.password) setPassword(current => current || saved.password);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const handleGoogleLogin = async () => {
    if (loading) return;
    setLoginError('');
    setBusy('google');
    try {
      await withAuthDeadline(loginWithGoogle(), 15000);
    } catch (error: unknown) {
      const message = t(loginErrorKey(error));
      setLoginError(message);
      toast.error(message);
    } finally {
      setBusy(null);
    }
  };

  const handlePasskeyLogin = async () => {
    if (loading) return;
    setLoginError('');
    setBusy('passkey');
    try {
      const result = await signInWithDevicePasskey();
      if (result.ok) return; // the session listener redirects to the dashboard
      if (isPasskeyCancellation(result.error)) return;
      const message = describePasskeyError(result.error, t.isRTL);
      setLoginError(message);
      toast.error(message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      className="flex min-h-[100dvh] w-full overflow-x-hidden bg-[#0a0a0f] lg:bg-background"
      dir={t.isRTL ? 'rtl' : 'ltr'}
    >
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
            <img src="/favicon.png?v=2" alt="Tracker" className="h-12 w-12 rounded-xl shadow-lg" />
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
      <div className="flex-1 min-w-0 relative overflow-hidden flex flex-col max-lg:h-[100dvh]">
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
        <div
          className="relative z-10 flex flex-1 min-h-0 flex-col"
          style={{
            // The PWA declares a translucent status bar (apple-mobile-web-app-
            // status-bar-style) and viewport-fit=cover, so the page paints under
            // the notch and the home indicator. Reserve those insets for the
            // content while the background stays full-bleed, instead of letting
            // the language pill sit behind the Dynamic Island.
            paddingTop: 'env(safe-area-inset-top, 0px)',
            paddingBottom: 'env(safe-area-inset-bottom, 0px)',
            paddingLeft: 'env(safe-area-inset-left, 0px)',
            paddingRight: 'env(safe-area-inset-right, 0px)',
          }}
        >
          {/* Language Toggle */}
          <div className="flex justify-end px-4 pt-3 pb-1">
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

          {/* Main Content — scrolls only when the phone is shorter than the
              form, so nothing is ever clipped under the notch or the home bar. */}
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
            <div className="flex min-h-full flex-col items-center justify-center px-6 py-3 lg:px-12 lg:py-8">
              <div className="w-full max-w-sm space-y-5 lg:space-y-8">
                {/* Mobile: Logo + Branding */}
                <div className="lg:hidden flex flex-col items-center gap-3">
                  <img src="/favicon.png?v=2" alt="Tracker" className="h-16 w-16 rounded-2xl shadow-2xl shadow-[#d4af37]/20" />
                  <div className="text-center">
                    <div className="text-xl font-black text-white tracking-tight">TRACKER</div>
                    <div className="text-[9px] text-[#d4af37] font-semibold uppercase tracking-[0.25em] mt-1">P2P Intelligence</div>
                  </div>
                  <h1 className="text-sm font-bold text-white/70 text-center mt-1 leading-snug">
                    {t('qatarPowered')}
                  </h1>
                </div>

                {/* Desktop: Welcome text */}
                <div className="hidden lg:block text-start">
                  <h2 className="text-2xl font-black text-foreground tracking-tight">{t('welcomeBack')}</h2>
                  <p className="text-sm text-muted-foreground mt-1">{t('secureTrading')}</p>
                </div>

                {/* One sign-in form for both roles: a merchant types their
                    email, a customer the username their merchant issued. Where
                    the account lands is resolved from its profiles afterwards,
                    so nobody has to know which "portal" they belong to. */}
                <div className="space-y-2.5">
                  <p className="text-[10px] font-semibold text-white/40 lg:text-muted-foreground uppercase tracking-[0.15em]">
                    {t.isRTL ? 'تسجيل الدخول' : 'Sign in'}
                  </p>
                  <form
                    className="space-y-2.5"
                    autoComplete="on"
                    onSubmit={e => { e.preventDefault(); handleUsernameLogin(); }}
                  >
                    {/* name/id/autocomplete are what let iOS offer its own
                        AutoFill when the page runs in Safari; the saved-login
                        store covers the standalone web app, where it cannot. */}
                    <label htmlFor="login-username" className="sr-only">
                      {t.isRTL ? 'اسم المستخدم أو البريد الإلكتروني' : 'Username or email'}
                    </label>
                    <input
                      id="login-username"
                      name="username"
                      type="text"
                      inputMode="email"
                      autoComplete="username"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      enterKeyHint="next"
                      placeholder={t.isRTL ? 'اسم المستخدم أو البريد الإلكتروني' : 'Username or email'}
                      value={username}
                      onChange={e => setUsername(e.target.value)}
                      disabled={loading}
                      className="w-full h-12 rounded-xl px-4 text-sm bg-white/[0.06] text-white placeholder:text-white/40 lg:bg-muted lg:text-foreground lg:placeholder:text-muted-foreground border border-white/10 lg:border-input focus:outline-none focus:ring-2 focus:ring-[#d4af37]/50"
                    />
                    <label htmlFor="login-password" className="sr-only">
                      {t.isRTL ? 'كلمة المرور' : 'Password'}
                    </label>
                    <input
                      id="login-password"
                      name="password"
                      type="password"
                      autoComplete="current-password"
                      enterKeyHint="go"
                      placeholder={t.isRTL ? 'كلمة المرور' : 'Password'}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      disabled={loading}
                      className="w-full h-12 rounded-xl px-4 text-sm bg-white/[0.06] text-white placeholder:text-white/40 lg:bg-muted lg:text-foreground lg:placeholder:text-muted-foreground border border-white/10 lg:border-input focus:outline-none focus:ring-2 focus:ring-[#d4af37]/50"
                    />
                    {loginError && <p className="text-xs text-red-400 lg:text-destructive">{loginError}</p>}
                    <label className="flex items-center gap-2 pt-0.5 text-[11px] font-medium text-white/50 lg:text-muted-foreground cursor-pointer select-none">
                      <input
                        type="checkbox"
                        name="remember"
                        checked={remember}
                        onChange={e => setRemember(e.target.checked)}
                        disabled={loading}
                        className="h-4 w-4 rounded border-white/25 bg-white/10 accent-[#d4af37] lg:accent-primary"
                      />
                      {t.isRTL ? 'تذكرني على هذا الجهاز' : 'Remember me on this device'}
                    </label>
                    <Button type="submit" className="w-full h-12 text-sm font-semibold rounded-xl lg:bg-primary lg:text-primary-foreground max-lg:bg-[#d4af37] max-lg:text-black max-lg:hover:bg-[#d4af37]/90" size="lg" disabled={loading}>
                      {busy === 'password' ? <Loader2 className="h-5 w-5 animate-spin" /> : (t.isRTL ? 'تسجيل الدخول' : 'Sign in')}
                    </Button>
                  </form>
                  {/* Only shown on devices that can actually run a platform
                      passkey ceremony (Face ID / Touch ID / fingerprint). */}
                  {passkeyAvailable && (
                    <Button
                      type="button"
                      variant="outline"
                      size="lg"
                      onClick={handlePasskeyLogin}
                      disabled={loading}
                      className="w-full h-12 text-sm font-semibold gap-2 rounded-xl border-[#d4af37]/40 bg-[#d4af37]/10 text-[#d4af37] hover:bg-[#d4af37]/15 hover:text-[#d4af37] lg:border-input lg:bg-transparent lg:text-foreground lg:hover:bg-muted"
                    >
                      {busy === 'passkey' ? (
                        <Loader2 className="h-5 w-5 animate-spin" />
                      ) : (
                        <ScanFace className="h-5 w-5" />
                      )}
                      {t.isRTL ? 'الدخول بـ Face ID' : 'Sign in with Face ID'}
                    </Button>
                  )}
                </div>

                <div className="flex items-center gap-3 text-[10px] text-white/30 lg:text-muted-foreground/60">
                  <div className="h-px flex-1 bg-white/10 lg:bg-border" />
                  <span>{t.isRTL ? 'أو' : 'or'}</span>
                  <div className="h-px flex-1 bg-white/10 lg:bg-border" />
                </div>

                {/* Google Sign In */}
                <Button type="button"
                  className={cn(
                    'w-full h-12 text-sm font-semibold gap-3 rounded-xl shadow-sm',
                    'lg:bg-primary lg:text-primary-foreground',
                    'max-lg:bg-white max-lg:text-black max-lg:hover:bg-white/90'
                  )}
                  size="lg" onClick={handleGoogleLogin} disabled={loading}>
                  {busy === 'google' ? (
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
          </div>

          {/* Mobile Footer */}
          <div className="lg:hidden flex items-center justify-center gap-2 pt-1 pb-3">
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
