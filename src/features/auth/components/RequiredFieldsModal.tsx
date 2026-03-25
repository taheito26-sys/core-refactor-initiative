import { useState } from 'react';
import { useAuth } from '@/features/auth/auth-context';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { toast } from 'sonner';

/**
 * RequiredFieldsModal
 *
 * Renders a non-dismissable dialog whenever the authenticated user's merchant
 * profile is missing display_name or merchant_id. The user cannot interact
 * with the app until both fields are saved.
 */
export function RequiredFieldsModal() {
  const { merchantProfile, refreshProfile } = useAuth();

  const missingDisplayName = !merchantProfile?.display_name?.trim();
  const missingMerchantId = !merchantProfile?.merchant_id?.trim();
  const isOpen = !!(merchantProfile && (missingDisplayName || missingMerchantId));

  const [displayName, setDisplayName] = useState(merchantProfile?.display_name ?? '');
  const [merchantId, setMerchantId] = useState(merchantProfile?.merchant_id ?? '');
  const [merchantIdStatus, setMerchantIdStatus] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle');
  const [saving, setSaving] = useState(false);

  if (!isOpen) return null;

  const checkMerchantId = async (value: string) => {
    if (value.length < 3) { setMerchantIdStatus('idle'); return; }
    setMerchantIdStatus('checking');
    try {
      const { data } = await supabase
        .from('merchant_profiles')
        .select('id')
        .eq('merchant_id', value)
        .neq('id', merchantProfile!.id)   // exclude own record
        .maybeSingle();
      setMerchantIdStatus(data ? 'taken' : 'available');
    } catch {
      setMerchantIdStatus('idle');
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!displayName.trim()) {
      toast.error('Display Name is required.');
      return;
    }
    if (!merchantId.trim()) {
      toast.error('Merchant ID is required.');
      return;
    }
    if (merchantIdStatus === 'taken') {
      toast.error('That Merchant ID is already taken. Please choose another.');
      return;
    }

    setSaving(true);
    try {
      const updates: Record<string, string> = {};
      if (missingDisplayName) updates.display_name = displayName.trim();
      if (missingMerchantId) {
        updates.merchant_id = merchantId.trim();
        updates.nickname = merchantId.trim();
      }

      const { error } = await supabase
        .from('merchant_profiles')
        .update(updates)
        .eq('id', merchantProfile!.id);

      if (error) throw error;

      await refreshProfile();
      toast.success('Profile updated successfully!');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save profile. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open modal>
      {/* Prevent closing by not providing onOpenChange — the Dialog stays open */}
      <DialogContent
        className="sm:max-w-md"
        // Disable the default close button via CSS since shadcn renders it internally
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <div className="flex items-center gap-2 text-amber-500 mb-1">
            <AlertTriangle className="h-5 w-5 shrink-0" />
            <DialogTitle className="text-foreground">Complete Your Profile</DialogTitle>
          </div>
          <DialogDescription>
            Your account is missing required information. Please fill in the fields below
            before you can use the app.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSave} className="space-y-4 pt-2">
          {/* Display Name */}
          <div className="space-y-1.5">
            <Label htmlFor="rf-display-name">
              Display Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="rf-display-name"
              placeholder="e.g. Ahmed Al-Rashid"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              minLength={2}
              maxLength={80}
              disabled={saving || !missingDisplayName}
              className={!missingDisplayName ? 'opacity-60' : ''}
            />
            {!missingDisplayName && (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3 text-green-500" /> Already set
              </p>
            )}
          </div>

          {/* Merchant ID */}
          <div className="space-y-1.5">
            <Label htmlFor="rf-merchant-id">
              Merchant ID <span className="text-destructive">*</span>
            </Label>
            <div className="relative">
              <Input
                id="rf-merchant-id"
                placeholder="e.g. ahmed_trader"
                value={merchantId}
                onChange={(e) => {
                  const v = e.target.value.toLowerCase().replace(/[^a-z0-9_.-]/g, '');
                  setMerchantId(v);
                  checkMerchantId(v);
                }}
                required
                minLength={3}
                maxLength={32}
                dir="ltr"
                disabled={saving || !missingMerchantId}
                className={`pr-8 ${!missingMerchantId ? 'opacity-60' : ''}`}
              />
              <div className="absolute right-2 top-1/2 -translate-y-1/2">
                {merchantIdStatus === 'checking' && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                {merchantIdStatus === 'available' && <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />}
                {merchantIdStatus === 'taken' && <XCircle className="h-3.5 w-3.5 text-destructive" />}
              </div>
            </div>
            {missingMerchantId ? (
              <p className="text-xs text-muted-foreground">
                Unique identifier — lowercase letters, numbers, underscores, dots and hyphens only.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3 text-green-500" /> Already set
              </p>
            )}
            {merchantIdStatus === 'taken' && (
              <p className="text-xs text-destructive">This Merchant ID is already taken.</p>
            )}
          </div>

          <Button
            type="submit"
            className="w-full"
            disabled={saving || merchantIdStatus === 'taken' || merchantIdStatus === 'checking'}
          >
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save &amp; Continue
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
