import { useState } from 'react';
import { useAuth } from '@/features/auth/auth-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, LogOut, User, Shield } from 'lucide-react';
import { toast } from 'sonner';
import { CUSTOMER_COUNTRIES, updateCustomerProfile } from '@/features/customer/customer-portal';
import { resolveCustomerLabel } from '@/features/merchants/lib/customer-labels';
import { useT } from '@/lib/i18n';

export default function CustomerSettingsPage() {
  const { customerProfile, userId, refreshProfile, logout, email } = useAuth();
  const countryStorageKey = userId ? `p2p_customer_country_${userId}` : 'p2p_customer_country';
  const [displayName, setDisplayName] = useState(customerProfile?.display_name ?? '');
  const [phone, setPhone] = useState(customerProfile?.phone ?? '');
  const [region, setRegion] = useState(customerProfile?.region ?? '');
  const [country, setCountry] = useState(() => {
    const storedCountry = localStorage.getItem(countryStorageKey);
    return customerProfile?.country ?? storedCountry ?? CUSTOMER_COUNTRIES[0];
  });
  const [saving, setSaving] = useState(false);
  const t = useT();
  const customerLabel = resolveCustomerLabel({
    displayName: customerProfile?.display_name,
    name: null,
    nickname: null,
    customerUserId: email ?? userId ?? 'Customer',
  });

  const handleSave = async () => {
    if (!userId) return;
    if (!displayName.trim()) {
      toast.error(t('customerDisplayNameRequired'));
      return;
    }
    setSaving(true);
    try {
      const { error } = await updateCustomerProfile(userId, {
        display_name: displayName.trim(),
        phone: phone.trim() || null,
        region: region.trim() || null,
        country,
      });
      if (error) throw error;
      localStorage.setItem(countryStorageKey, country);
      await refreshProfile();
      toast.success(t('customerProfileUpdated'));
    } catch (err: any) {
      toast.error(err?.message || t('customerSaveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t('customerSettingsTitle')}</h1>

      {/* Account Info */}
      <Card>
        <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
            <Shield className="h-4 w-4" /> {t('customerAccount')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary font-bold">
              {customerLabel[0]?.toUpperCase() ?? 'C'}
            </div>
            <div>
              <p className="font-medium">{customerLabel}</p>
              <p className="text-sm text-muted-foreground">{email}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Profile Edit */}
      <Card>
        <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
            <User className="h-4 w-4" /> {t('customerProfileLabel')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>{t('displayName')}</Label>
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>{t('phone')}</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t('optional')} />
          </div>
          <div className="space-y-2">
            <Label>{t('region')}</Label>
            <Input value={region} onChange={(e) => setRegion(e.target.value)} placeholder={t('optional')} />
          </div>
          <div className="space-y-2">
            <Label>{t('country')}</Label>
            <Select value={country} onValueChange={setCountry}>
              <SelectTrigger>
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
          <Button onClick={handleSave} disabled={saving} className="w-full">
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t('saveChanges')}
          </Button>
        </CardContent>
      </Card>

      {/* Sign Out */}
      <Card>
        <CardContent className="p-4">
          <Button variant="destructive" className="w-full gap-2" onClick={() => logout()}>
            <LogOut className="h-4 w-4" /> {t('signOut')}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
