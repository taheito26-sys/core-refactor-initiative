import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/features/auth/auth-context';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, UserCircle } from 'lucide-react';
import { toast } from 'sonner';
import { CUSTOMER_COUNTRIES } from '@/features/customer/customer-portal';
import { useT } from '@/lib/i18n';

export default function CustomerOnboardingPage() {
  const { userId, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState('');
  const [phone, setPhone] = useState('');
  const [region, setRegion] = useState('');
  const [country, setCountry] = useState(() => localStorage.getItem('p2p_signup_country') ?? CUSTOMER_COUNTRIES[0]);
  const [currency, setCurrency] = useState('USDT');
  const [loading, setLoading] = useState(false);
  const t = useT();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim()) {
      toast.error(t('customerDisplayNameRequired'));
      return;
    }
    if (!country) {
      toast.error(t('customerCountryRequired'));
      return;
    }
    if (!userId) return;

    setLoading(true);
    try {
      // Insert customer profile
      const { error: cpError } = await supabase.from('customer_profiles').insert({
        user_id: userId,
        display_name: displayName.trim(),
        phone: phone.trim() || null,
        region: region.trim() || null,
        country,
        preferred_currency: currency,
      });
      if (cpError) throw cpError;

      // Update profiles.role to customer
      const { error: pError } = await supabase
        .from('profiles')
        .update({ role: 'customer' })
        .eq('user_id', userId);
      if (pError) throw pError;

      await refreshProfile();
      toast.success(t('customerWelcomeReady'));
      navigate('/c/home', { replace: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('customerSaveFailed');
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
            <UserCircle className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-2xl">{t('customerSetupTitle')}</CardTitle>
          <CardDescription>{t('customerSetupDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="displayName">{t('displayName')} *</Label>
              <Input
                id="displayName"
                placeholder={t('displayName')}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="country">{t('country')} *</Label>
              <Select value={country} onValueChange={setCountry}>
                <SelectTrigger id="country">
                  <SelectValue placeholder={t('customerSelectCountry')} />
                </SelectTrigger>
                <SelectContent>
                  {CUSTOMER_COUNTRIES.map((item) => (
                    <SelectItem key={item} value={item}>
                      {item}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">{t('phone')}</Label>
              <Input
                id="phone"
                type="tel"
                placeholder={t('phone')}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="region">{t('region')}</Label>
              <Input
                id="region"
                placeholder={t('region')}
                value={region}
                onChange={(e) => setRegion(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('customerPreferredCurrency')}</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="USDT">USDT</SelectItem>
                  <SelectItem value="QAR">QAR</SelectItem>
                  <SelectItem value="EGP">EGP</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('completeSetup')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
