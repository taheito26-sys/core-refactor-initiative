import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/features/auth/auth-context';
import { supabase } from '@/integrations/supabase/client';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { CUSTOMER_COUNTRIES } from '@/features/customer/customer-portal';

export default function CustomerOnboardingPage() {
  const { userId, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState('');
  const [country,     setCountry]     = useState(CUSTOMER_COUNTRIES[0]);
  const [phone,       setPhone]       = useState('');
  const [loading,     setLoading]     = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim()) { toast.error('Name is required'); return; }
    if (!userId) return;
    setLoading(true);
    try {
      const { error: cpErr } = await supabase.from('customer_profiles').insert({
        user_id: userId,
        display_name: displayName.trim(),
        phone: phone.trim() || null,
        preferred_currency: 'USDT',
      });
      if (cpErr) throw cpErr;
      localStorage.setItem('p2p_customer_country', country);
      await supabase.from('profiles').update({ role: 'customer' }).eq('user_id', userId);
      await refreshProfile();
      navigate('/c/home', { replace: true });
    } catch (err: any) {
      toast.error(err?.message ?? 'Setup failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-6">
        {/* Logo */}
        <div className="text-center">
          <p className="text-xs font-black uppercase tracking-widest text-muted-foreground">Tracker</p>
          <h1 className="mt-1 text-2xl font-black text-foreground">Set up your account</h1>
          <p className="mt-1 text-sm text-muted-foreground">Takes 30 seconds</p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Your name</label>
            <input
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder="e.g. Ahmed"
              required
              className="h-11 w-full rounded-xl border border-border/50 bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Country</label>
            <select
              value={country}
              onChange={e => setCountry(e.target.value as any)}
              className="h-11 w-full rounded-xl border border-border/50 bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30"
            >
              {CUSTOMER_COUNTRIES.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Phone <span className="text-muted-foreground/60">(optional)</span>
            </label>
            <input
              value={phone}
              onChange={e => setPhone(e.target.value)}
              type="tel"
              placeholder="+974…"
              className="h-11 w-full rounded-xl border border-border/50 bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            Get started
          </button>
        </form>
      </div>
    </div>
  );
}
