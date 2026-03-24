import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/features/auth/auth-context';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useT } from '@/lib/i18n';

export default function OnboardingPage() {
  const { refreshProfile, userId, merchantProfile, isLoading } = useAuth();
  const navigate = useNavigate();
  const t = useT();
  const [loading, setLoading] = useState(false);
  const [nicknameStatus, setNicknameStatus] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle');

  const [form, setForm] = useState({
    display_name: '',
    nickname: '',
    region: '',
    default_currency: 'USDT',
    bio: '',
  });

  useEffect(() => {
    if (!isLoading && merchantProfile) {
      navigate('/dashboard', { replace: true });
    }
  }, [isLoading, merchantProfile, navigate]);

  const checkNickname = async (nick: string) => {
    if (nick.length < 3) { setNicknameStatus('idle'); return; }
    setNicknameStatus('checking');
    try {
      const { data } = await supabase
        .from('merchant_profiles')
        .select('id')
        .eq('merchant_id', nick)
        .maybeSingle();
      setNicknameStatus(data ? 'taken' : 'available');
    } catch {
      setNicknameStatus('idle');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (nicknameStatus === 'taken') {
      toast.error(t('onboardNickTaken'));
      return;
    }
    if (!userId) {
      toast.error('Not authenticated');
      return;
    }
    setLoading(true);
    try {
      // Generate a unique 4-digit merchant code
      let merchantCode = '';
      let codeUnique = false;
      while (!codeUnique) {
        merchantCode = String(Math.floor(1000 + Math.random() * 9000));
        const { data: existing } = await (supabase
          .from('merchant_profiles') as any)
          .select('id')
          .eq('merchant_code', merchantCode)
          .maybeSingle();
        codeUnique = !existing;
      }

      const insertPayload: any = {
        user_id: userId,
        merchant_id: form.nickname,
        nickname: form.nickname,
        display_name: form.display_name,
        region: form.region || null,
        default_currency: form.default_currency || 'USDT',
        bio: form.bio || null,
        merchant_code: merchantCode,
      };
      const { error } = await supabase.from('merchant_profiles').insert(insertPayload);
      if (error) throw error;
      await refreshProfile();
      toast.success(t('onboardSuccess'));
      navigate('/dashboard');
    } catch (err: unknown) {
      await refreshProfile();
      const message = err instanceof Error ? err.message : 'Failed to create profile';

      if (message.toLowerCase().includes('duplicate') || message.includes('409')) {
        toast.info(t('onboardDuplicate'));
        navigate('/dashboard', { replace: true });
        return;
      }

      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4" dir={t.isRTL ? 'rtl' : 'ltr'}>
      <Card className="w-full max-w-lg">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">{t('onboardTitle')}</CardTitle>
          <CardDescription>{t('onboardDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="display_name">{t('onboardDisplayName')}</Label>
              <Input
                id="display_name"
                placeholder={t('onboardDisplayNamePh')}
                value={form.display_name}
                onChange={(e) => setForm(f => ({ ...f, display_name: e.target.value }))}
                required
                minLength={2}
                maxLength={80}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="nickname">{t('onboardNickname')}</Label>
              <div className="relative">
                <Input
                  id="nickname"
                  placeholder={t('onboardNicknamePh')}
                  value={form.nickname}
                  onChange={(e) => {
                    const v = e.target.value.toLowerCase().replace(/[^a-z0-9_.-]/g, '');
                    setForm(f => ({ ...f, nickname: v }));
                    checkNickname(v);
                  }}
                  required
                  minLength={3}
                  maxLength={32}
                  className="pr-8"
                  dir="ltr"
                />
                <div className="absolute right-2 top-1/2 -translate-y-1/2">
                  {nicknameStatus === 'available' && <CheckCircle2 className="h-4 w-4 text-success" />}
                  {nicknameStatus === 'taken' && <XCircle className="h-4 w-4 text-destructive" />}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">{t('onboardNicknameHint')}</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="region">{t('onboardRegion')}</Label>
              <Input
                id="region"
                placeholder={t('onboardRegionPh')}
                value={form.region}
                onChange={(e) => setForm(f => ({ ...f, region: e.target.value }))}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="default_currency">{t('onboardCurrency')}</Label>
              <Input
                id="default_currency"
                placeholder="USDT"
                value={form.default_currency}
                onChange={(e) => setForm(f => ({ ...f, default_currency: e.target.value.toUpperCase() }))}
                dir="ltr"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="bio">{t('onboardBio')}</Label>
              <Textarea
                id="bio"
                placeholder={t('onboardBioPh')}
                value={form.bio}
                onChange={(e) => setForm(f => ({ ...f, bio: e.target.value }))}
                rows={3}
              />
            </div>

            <Button type="submit" className="w-full" disabled={loading || nicknameStatus === 'taken'}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('onboardSubmit')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
