import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/features/auth/auth-context';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { toast } from 'sonner';

export default function OnboardingPage() {
  const { refreshProfile, userId, merchantProfile, isLoading } = useAuth();
  const navigate = useNavigate();
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
      toast.error('That nickname is already taken');
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
        const { data: existing } = await supabase
          .from('merchant_profiles')
          .select('id')
          .eq('merchant_code' as any, merchantCode)
          .maybeSingle();
        codeUnique = !existing;
      }

      const { error } = await supabase.from('merchant_profiles').insert({
        user_id: userId,
        merchant_id: form.nickname,
        nickname: form.nickname,
        display_name: form.display_name,
        region: form.region || null,
        default_currency: form.default_currency || 'USDT',
        bio: form.bio || null,
        merchant_code: merchantCode,
      } as any);
      if (error) throw error;
      await refreshProfile();
      toast.success('Merchant profile created!');
      navigate('/dashboard');
    } catch (err: unknown) {
      await refreshProfile();
      const message = err instanceof Error ? err.message : 'Failed to create profile';

      if (message.toLowerCase().includes('duplicate') || message.includes('409')) {
        toast.info('Merchant profile already exists. Redirecting to dashboard.');
        navigate('/dashboard', { replace: true });
        return;
      }

      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-lg">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Set Up Your Merchant Profile</CardTitle>
          <CardDescription>
            Complete your profile to start trading on the TRACKER platform.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="display_name">Display Name</Label>
              <Input
                id="display_name"
                placeholder="Your display name"
                value={form.display_name}
                onChange={(e) => setForm(f => ({ ...f, display_name: e.target.value }))}
                required
                minLength={2}
                maxLength={80}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="nickname">Public Nickname</Label>
              <div className="relative">
                <Input
                  id="nickname"
                  placeholder="unique_handle"
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
                />
                <div className="absolute right-2 top-1/2 -translate-y-1/2">
                  {nicknameStatus === 'available' && <CheckCircle2 className="h-4 w-4 text-success" />}
                  {nicknameStatus === 'taken' && <XCircle className="h-4 w-4 text-destructive" />}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Lowercase letters, numbers, dots, hyphens, underscores only.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="region">Region</Label>
              <Input
                id="region"
                placeholder="e.g. Middle East, Asia"
                value={form.region}
                onChange={(e) => setForm(f => ({ ...f, region: e.target.value }))}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="default_currency">Default Currency</Label>
              <Input
                id="default_currency"
                placeholder="USDT"
                value={form.default_currency}
                onChange={(e) => setForm(f => ({ ...f, default_currency: e.target.value.toUpperCase() }))}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="bio">Bio (optional)</Label>
              <Textarea
                id="bio"
                placeholder="Tell others about your trading focus..."
                value={form.bio}
                onChange={(e) => setForm(f => ({ ...f, bio: e.target.value }))}
                rows={3}
              />
            </div>

            <Button type="submit" className="w-full" disabled={loading || nicknameStatus === 'taken'}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create Profile
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
