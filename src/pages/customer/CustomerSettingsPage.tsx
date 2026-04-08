import { useState } from 'react';
import { useAuth } from '@/features/auth/auth-context';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Loader2, LogOut, User, Shield } from 'lucide-react';
import { toast } from 'sonner';

export default function CustomerSettingsPage() {
  const { customerProfile, userId, refreshProfile, logout, email } = useAuth();
  const [displayName, setDisplayName] = useState(customerProfile?.display_name ?? '');
  const [phone, setPhone] = useState(customerProfile?.phone ?? '');
  const [region, setRegion] = useState(customerProfile?.region ?? '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!userId) return;
    if (!displayName.trim()) {
      toast.error('Display name is required');
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from('customer_profiles')
        .update({
          display_name: displayName.trim(),
          phone: phone.trim() || null,
          region: region.trim() || null,
        })
        .eq('user_id', userId);
      if (error) throw error;
      await refreshProfile();
      toast.success('Profile updated');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      {/* Account Info */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="h-4 w-4" /> Account
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary font-bold">
              {customerProfile?.display_name?.[0]?.toUpperCase() ?? 'C'}
            </div>
            <div>
              <p className="font-medium">{customerProfile?.display_name}</p>
              <p className="text-sm text-muted-foreground">{email}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Profile Edit */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <User className="h-4 w-4" /> Profile
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Display Name</Label>
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Phone</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Optional" />
          </div>
          <div className="space-y-2">
            <Label>Region</Label>
            <Input value={region} onChange={(e) => setRegion(e.target.value)} placeholder="Optional" />
          </div>
          <Button onClick={handleSave} disabled={saving} className="w-full">
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Changes
          </Button>
        </CardContent>
      </Card>

      {/* Sign Out */}
      <Card>
        <CardContent className="p-4">
          <Button variant="destructive" className="w-full gap-2" onClick={() => logout()}>
            <LogOut className="h-4 w-4" /> Sign Out
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
