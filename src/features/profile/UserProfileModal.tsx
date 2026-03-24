import { useState, useEffect } from 'react';
import { useAuth } from '@/features/auth/auth-context';
import { useT } from '@/lib/i18n';
import { getCurrentTrackerState } from '@/lib/tracker-backup';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  User,
  Mail,
  Hash,
  Globe,
  Coins,
  TrendingUp,
  Package,
  Users,
  Truck,
  Clock,
  LogIn,
  Cloud,
  CloudDownload,
  Database,
  CalendarDays,
  ShieldCheck,
} from 'lucide-react';

interface ProfileData {
  firstSeen: number;
  loginCount: number;
  lastLogin: number;
  lastCloudBackup: number;
  lastCloudRestore: number;
  sessions: number;
  trades: number;
  batches: number;
  customers: number;
  suppliers: number;
  stateKB: number;
  uid5: string;
}

const FS_KEY = 'taheito_first_seen_ts';
const LC_KEY = 'taheito_login_count';
const LL_KEY = 'taheito_last_login_ts';
const LB_KEY = 'taheito_last_cloud_backup_ts';
const LR_KEY = 'taheito_last_cloud_restore_ts';

export function touchLogin() {
  try {
    const now = Date.now();
    if (!localStorage.getItem(FS_KEY)) localStorage.setItem(FS_KEY, String(now));
    const lc = (+localStorage.getItem(LC_KEY)! || 0) + 1;
    localStorage.setItem(LC_KEY, String(lc));
    localStorage.setItem(LL_KEY, String(now));
  } catch {}
}

function getProfileData(email: string, merchantId: string): ProfileData {
  const fs = +localStorage.getItem(FS_KEY)! || Date.now();
  if (!localStorage.getItem(FS_KEY)) localStorage.setItem(FS_KEY, String(fs));
  const lc = +localStorage.getItem(LC_KEY)! || 0;
  const ll = +localStorage.getItem(LL_KEY)! || 0;
  const lb = +localStorage.getItem(LB_KEY)! || 0;
  const lr = +localStorage.getItem(LR_KEY)! || 0;
  let sess = 0;
  try {
    const arr = JSON.parse(localStorage.getItem('taheito_sessions_v1') || '[]');
    sess = Array.isArray(arr) ? arr.length : 0;
  } catch {}
  const st = getCurrentTrackerState(localStorage) as any;
  const trades = Array.isArray(st?.trades) ? st.trades.length : 0;
  const batches = Array.isArray(st?.batches) ? st.batches.length : 0;
  const customers = Array.isArray(st?.customers) ? st.customers.length : 0;
  const suppliers = Array.isArray(st?.suppliers) ? st.suppliers.length : 0;
  let szKB = 0;
  try { szKB = Math.max(1, Math.ceil(JSON.stringify(st || {}).length / 1024)); } catch {}

  let uid5 = '';
  const rawMid = String(merchantId || '').trim();
  const midDigits = rawMid.replace(/\D/g, '');
  if (midDigits.length >= 5) uid5 = midDigits.slice(-5);
  if (!uid5) {
    const base = String((email || rawMid || 'guest') + '|uid5');
    let h = 0;
    for (let i = 0; i < base.length; i++) { h = ((h << 5) - h) + base.charCodeAt(i); h |= 0; }
    uid5 = String(Math.abs(h) % 90000 + 10000);
  }
  localStorage.setItem('taheito_uid5', uid5);

  return { firstSeen: fs, loginCount: lc, lastLogin: ll, lastCloudBackup: lb, lastCloudRestore: lr, sessions: sess, trades, batches, customers, suppliers, stateKB: szKB, uid5 };
}

function fmtDate(ts: number, isAr: boolean) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString(isAr ? 'ar' : 'en-GB', {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

function fmtDateTime(ts: number, isAr: boolean) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString(isAr ? 'ar' : 'en-GB', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function getInitials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? '')
    .join('');
}

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  color: string;
}

function StatCard({ icon, label, value, color }: StatCardProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 rounded-xl border border-border bg-muted/40 p-3 text-center">
      <div className={`flex items-center justify-center rounded-lg p-1.5 ${color}`}>
        {icon}
      </div>
      <span className="text-xl font-bold tabular-nums text-foreground leading-none">{value}</span>
      <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide leading-tight">{label}</span>
    </div>
  );
}

interface InfoRowProps {
  icon: React.ReactNode;
  label: string;
  value: string;
}

function InfoRow({ icon, label, value }: InfoRowProps) {
  return (
    <div className="flex items-center gap-2.5 py-1.5">
      <div className="flex-shrink-0 text-muted-foreground">{icon}</div>
      <span className="text-[11px] text-muted-foreground min-w-[80px] font-medium">{label}</span>
      <span className="text-[12px] text-foreground font-semibold truncate">{value || '—'}</span>
    </div>
  );
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export function UserProfileModal({ open, onClose }: Props) {
  const t = useT();
  const { email, merchantProfile, profile } = useAuth();
  const [data, setData] = useState<ProfileData | null>(null);

  const isAr = t.lang === 'ar';

  useEffect(() => {
    if (open) setData(getProfileData(email || '', merchantProfile?.merchant_id || ''));
  }, [open, email, merchantProfile?.merchant_id]);

  const displayName = merchantProfile?.display_name || email?.split('@')[0] || 'User';
  const initials = getInitials(displayName);

  const memberSince = profile?.created_at
    ? fmtDate(new Date(profile.created_at).getTime(), isAr)
    : data ? fmtDate(data.firstSeen, isAr) : '—';

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md p-0 overflow-hidden gap-0">
        {/* ── Header banner ── */}
        <div className="relative bg-gradient-to-br from-primary/20 via-primary/10 to-background px-6 pt-6 pb-4">
          <div className="flex items-start gap-4">
            {/* Avatar */}
            <div className="relative flex-shrink-0">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground text-xl font-bold shadow-lg">
                {initials || <User className="h-6 w-6" />}
              </div>
              <div className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 shadow">
                <ShieldCheck className="h-3 w-3 text-white" />
              </div>
            </div>

            {/* Name + meta */}
            <div className="flex-1 min-w-0">
              <DialogTitle className="text-base font-bold text-foreground leading-tight truncate">
                {displayName}
              </DialogTitle>
              {merchantProfile?.nickname && (
                <p className="text-[11px] text-muted-foreground mt-0.5">@{merchantProfile.nickname}</p>
              )}
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                {data?.uid5 && (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 font-mono">
                    #{data.uid5}
                  </Badge>
                )}
                <Badge
                  variant="outline"
                  className="text-[10px] px-1.5 py-0 h-5 border-emerald-500/40 text-emerald-600 bg-emerald-500/10"
                >
                  {profile?.status === 'approved'
                    ? (isAr ? 'معتمد' : 'Approved')
                    : (profile?.status ?? (isAr ? 'نشط' : 'Active'))}
                </Badge>
              </div>
            </div>
          </div>

          {/* Member since */}
          <div className="flex items-center gap-1.5 mt-3">
            <CalendarDays className="h-3 w-3 text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground">
              {isAr ? 'عضو منذ' : 'Member since'} {memberSince}
            </span>
          </div>
        </div>

        <div className="px-6 py-4 space-y-4">
          {/* ── Activity stats ── */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
              {isAr ? 'إحصائيات النشاط' : 'Activity Stats'}
            </p>
            <div className="grid grid-cols-4 gap-2">
              <StatCard
                icon={<TrendingUp className="h-3.5 w-3.5 text-white" />}
                label={isAr ? 'صفقات' : 'Trades'}
                value={data?.trades ?? '—'}
                color="bg-blue-500"
              />
              <StatCard
                icon={<Package className="h-3.5 w-3.5 text-white" />}
                label={isAr ? 'دفعات' : 'Batches'}
                value={data?.batches ?? '—'}
                color="bg-violet-500"
              />
              <StatCard
                icon={<Users className="h-3.5 w-3.5 text-white" />}
                label={isAr ? 'عملاء' : 'Clients'}
                value={data?.customers ?? '—'}
                color="bg-amber-500"
              />
              <StatCard
                icon={<Truck className="h-3.5 w-3.5 text-white" />}
                label={isAr ? 'موردون' : 'Suppliers'}
                value={data?.suppliers ?? '—'}
                color="bg-emerald-500"
              />
            </div>
          </div>

          <Separator />

          {/* ── Account details ── */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">
              {isAr ? 'تفاصيل الحساب' : 'Account Details'}
            </p>
            <div className="divide-y divide-border/50">
              {email && (
                <InfoRow
                  icon={<Mail className="h-3.5 w-3.5" />}
                  label={isAr ? 'البريد' : 'Email'}
                  value={email}
                />
              )}
              {merchantProfile?.merchant_id && (
                <InfoRow
                  icon={<Hash className="h-3.5 w-3.5" />}
                  label={isAr ? 'رقم التاجر' : 'Merchant ID'}
                  value={merchantProfile.merchant_id.slice(0, 12) + '…'}
                />
              )}
              {merchantProfile?.region && (
                <InfoRow
                  icon={<Globe className="h-3.5 w-3.5" />}
                  label={isAr ? 'المنطقة' : 'Region'}
                  value={merchantProfile.region}
                />
              )}
              {merchantProfile?.default_currency && (
                <InfoRow
                  icon={<Coins className="h-3.5 w-3.5" />}
                  label={isAr ? 'العملة' : 'Currency'}
                  value={merchantProfile.default_currency}
                />
              )}
            </div>
          </div>

          <Separator />

          {/* ── Session & sync info ── */}
          <div className="grid grid-cols-2 gap-3">
            {/* Session column */}
            <div className="space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">
                {isAr ? 'الجلسات' : 'Sessions'}
              </p>
              <div className="flex items-center gap-2">
                <LogIn className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                <div>
                  <p className="text-[10px] text-muted-foreground">{isAr ? 'عدد الدخول' : 'Logins'}</p>
                  <p className="text-sm font-bold tabular-nums">{data?.loginCount ?? '—'}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                <div>
                  <p className="text-[10px] text-muted-foreground">{isAr ? 'آخر دخول' : 'Last login'}</p>
                  <p className="text-[11px] font-semibold">{data ? fmtDateTime(data.lastLogin, isAr) : '—'}</p>
                </div>
              </div>
            </div>

            {/* Cloud column */}
            <div className="space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">
                {isAr ? 'السحابة' : 'Cloud Sync'}
              </p>
              <div className="flex items-center gap-2">
                <Cloud className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                <div>
                  <p className="text-[10px] text-muted-foreground">{isAr ? 'آخر نسخ' : 'Last backup'}</p>
                  <p className="text-[11px] font-semibold">{data ? fmtDate(data.lastCloudBackup, isAr) : '—'}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <CloudDownload className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                <div>
                  <p className="text-[10px] text-muted-foreground">{isAr ? 'آخر استعادة' : 'Last restore'}</p>
                  <p className="text-[11px] font-semibold">{data ? fmtDate(data.lastCloudRestore, isAr) : '—'}</p>
                </div>
              </div>
            </div>
          </div>

          {/* ── Data health bar ── */}
          {data && (
            <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2">
              <Database className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] text-muted-foreground font-medium">
                    {isAr ? 'حجم البيانات المحلية' : 'Local data size'}
                  </span>
                  <span className="text-[11px] font-bold tabular-nums">{data.stateKB} KB</span>
                </div>
                <div className="h-1.5 rounded-full bg-border overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${Math.min(100, (data.stateKB / 500) * 100)}%` }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* ── Bio ── */}
          {merchantProfile?.bio && (
            <p className="text-[11px] text-muted-foreground italic border-l-2 border-primary/40 pl-2 leading-relaxed">
              "{merchantProfile.bio}"
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
