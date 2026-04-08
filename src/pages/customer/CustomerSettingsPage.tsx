import { useState } from 'react';
import { useAuth } from '@/features/auth/auth-context';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export default function CustomerSettingsPage() {
  const { customerProfile, userId, refreshProfile } = useAuth();
  const [displayName, setDisplayName] = useState(customerProfile?.display_name ?? '');
  const [phone, setPhone] = useState(customerProfile?.phone ?? '');
  const [region, setRegion] = useState(customerProfile?.region ?? '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!userId) return;
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
      <Card>
        <CardHeader><CardTitle className="text-base">Profile</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Display Name</Label>
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Phone</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Region</Label>
            <Input value={region} onChange={(e) => setRegion(e.target.value)} />
          </div>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Changes
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
