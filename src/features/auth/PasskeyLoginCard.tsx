import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScanFace, ShieldCheck, Trash2, Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useT } from '@/lib/i18n';
import {
  describePasskeyError,
  getPasskeyAvailability,
  isPasskeyDisabled,
  listDevicePasskeys,
  passkeyDeviceName,
  registerDevicePasskey,
  removeDevicePasskey,
  setPasskeyEnrollmentHint,
  type PasskeyAvailability,
  type PasskeySummary,
} from '@/features/auth/passkeys';

function formatDate(value: string, isRTL: boolean): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(isRTL ? 'ar-QA' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

type Props = {
  /** "card" is the merchant settings glass card; "customer" matches the
   *  plain rounded panels of the customer portal settings screen. */
  variant?: 'card' | 'customer';
};

/**
 * Opt-in Face ID / Touch ID sign-in. Rendered in Settings for browsers and the
 * installed web app; hidden in the native shell, where WebAuthn has no domain
 * to bind a passkey to.
 */
export function PasskeyLoginCard({ variant = 'card' }: Props) {
  const t = useT();
  const isRTL = t.isRTL;
  const [availability, setAvailability] = useState<PasskeyAvailability | null>(null);
  const [passkeys, setPasskeys] = useState<PasskeySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'enroll' | string | null>(null);
  const [error, setError] = useState('');
  const [serverDisabled, setServerDisabled] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const list = await listDevicePasskeys();
      setPasskeys(list);
      // The server list is the source of truth for whether the login screen
      // should offer Face ID on this device.
      setPasskeyEnrollmentHint(list.length > 0);
    } catch (err) {
      if (isPasskeyDisabled(err)) {
        setServerDisabled(true);
        return;
      }
      setError(describePasskeyError(err, isRTL));
    } finally {
      setLoading(false);
    }
  }, [isRTL]);

  useEffect(() => {
    let alive = true;
    void getPasskeyAvailability().then(result => {
      if (!alive) return;
      setAvailability(result);
      if (result !== 'available') {
        setLoading(false);
        return;
      }
      void refresh();
    });
    return () => {
      alive = false;
    };
  }, [refresh]);

  const handleEnroll = async () => {
    if (busy) return;
    setBusy('enroll');
    setError('');
    const result = await registerDevicePasskey(passkeyDeviceName());
    if (result.ok) {
      toast.success(isRTL ? 'تم تفعيل الدخول بالبصمة على هذا الجهاز' : 'Face ID sign-in is on for this device');
      await refresh();
    } else {
      if (isPasskeyDisabled(result.error)) {
        setServerDisabled(true);
        setBusy(null);
        return;
      }
      const message = describePasskeyError(result.error, isRTL);
      setError(message);
      toast.error(message);
    }
    setBusy(null);
  };

  const handleRemove = async (passkey: PasskeySummary) => {
    if (busy) return;
    const label = passkey.friendlyName || (isRTL ? 'هذا الجهاز' : 'this device');
    const confirmed = window.confirm(
      isRTL
        ? `إزالة الدخول بالبصمة من ${label}؟`
        : `Remove Face ID sign-in for ${label}?`,
    );
    if (!confirmed) return;
    setBusy(passkey.id);
    setError('');
    try {
      await removeDevicePasskey(passkey.id);
      toast.success(isRTL ? 'تمت إزالة البصمة' : 'Face ID sign-in removed');
      await refresh();
    } catch (err) {
      const message = describePasskeyError(err, isRTL);
      setError(message);
      toast.error(message);
    } finally {
      setBusy(null);
    }
  };

  if (availability !== 'available' || serverDisabled) return null;

  const hasPasskey = passkeys.length > 0;

  const body: ReactNode = (
    <>
      <p className="text-[11px] text-muted-foreground leading-relaxed">
        {isRTL
          ? 'سجّل الدخول باستخدام Face ID أو Touch ID أو رمز الجهاز بدل كتابة كلمة المرور. يمكنك دائماً استخدام كلمة المرور كبديل.'
          : 'Sign in with Face ID, Touch ID, or your device passcode instead of typing your password. Your password always keeps working as a backup.'}
      </p>

      {loading ? (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {isRTL ? 'جارٍ التحقق…' : 'Checking…'}
        </div>
      ) : hasPasskey ? (
        <div className="space-y-2">
          {passkeys.map(passkey => (
            <div
              key={passkey.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-border/50 bg-muted/20 px-2.5 py-2"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold">
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                  <span className="truncate">
                    {passkey.friendlyName || (isRTL ? 'بصمة مسجّلة' : 'Registered passkey')}
                  </span>
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  {isRTL ? 'أُضيفت في ' : 'Added '}
                  {formatDate(passkey.createdAt, isRTL)}
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[10px] text-muted-foreground hover:text-destructive"
                disabled={busy !== null}
                onClick={() => void handleRemove(passkey)}
              >
                {busy === passkey.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
                <span className="ms-1">{isRTL ? 'إزالة' : 'Remove'}</span>
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full h-9 text-[11px]"
            disabled={busy !== null}
            onClick={() => void handleEnroll()}
          >
            {busy === 'enroll' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus className="h-3.5 w-3.5" />
            )}
            <span className="ms-1.5">
              {isRTL ? 'إضافة بصمة لهذا الجهاز' : 'Add a passkey for this device'}
            </span>
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          size="sm"
          className="w-full h-10 text-xs font-semibold"
          disabled={busy !== null}
          onClick={() => void handleEnroll()}
        >
          {busy === 'enroll' ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ScanFace className="h-4 w-4" />
          )}
          <span className="ms-1.5">{isRTL ? 'تفعيل Face ID' : 'Turn on Face ID'}</span>
        </Button>
      )}

      {error && <p className="text-[10px] text-destructive leading-snug">{error}</p>}

      <p className="text-[10px] text-muted-foreground/70 leading-snug">
        {isRTL
          ? 'تعمل البصمة في Safari وفي التطبيق المثبّت على الشاشة الرئيسية لنفس الموقع.'
          : 'Works in Safari and in the installed home-screen app for this site.'}
      </p>
    </>
  );

  if (variant === 'customer') {
    return (
      <div className="rounded-2xl border border-border/50 bg-card overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border/40">
          <ScanFace className="h-4 w-4 text-muted-foreground" />
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {isRTL ? 'الدخول بالبصمة' : 'Face ID sign-in'}
          </p>
        </div>
        <div className="px-4 py-4 space-y-3">{body}</div>
      </div>
    );
  }

  return (
    <Card className="glass">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-display flex items-center gap-2">
          <ScanFace className="h-4 w-4 text-primary" />
          {isRTL ? 'الدخول بالبصمة' : 'Face ID sign-in'}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">{body}</CardContent>
    </Card>
  );
}

export default PasskeyLoginCard;
