import { useState, useEffect } from 'react';
import { useAuth } from '@/features/auth/auth-context';
import { useT } from '@/lib/i18n';
import { getCurrentTrackerState } from '@/lib/tracker-backup';

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
  try { const arr = JSON.parse(localStorage.getItem('taheito_sessions_v1') || '[]'); sess = Array.isArray(arr) ? arr.length : 0; } catch {}
  const st = getCurrentTrackerState(localStorage) as any;
  const trades = Array.isArray(st?.trades) ? st.trades.length : 0;
  const batches = Array.isArray(st?.batches) ? st.batches.length : 0;
  const customers = Array.isArray(st?.customers) ? st.customers.length : 0;
  const suppliers = Array.isArray(st?.suppliers) ? st.suppliers.length : 0;
  let szKB = 0;
  try { szKB = Math.max(1, Math.ceil(JSON.stringify(st || {}).length / 1024)); } catch {}

  // UID5 generation
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

function fmtTs(ts: number, locale: string) {
  return ts ? new Date(ts).toLocaleString(locale === 'ar' ? 'ar' : undefined) : '—';
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export function UserProfileModal({ open, onClose }: Props) {
  const t = useT();
  const { email, merchantProfile } = useAuth();
  const [data, setData] = useState<ProfileData | null>(null);

  useEffect(() => {
    if (open) setData(getProfileData(email || '', merchantProfile?.merchant_id || ''));
  }, [open, email, merchantProfile?.merchant_id]);

  if (!open || !data) return null;

  const loc = t.lang === 'ar' ? 'ar' : 'en';
  const pill = (label: string) => (
    <span className="pill" style={{ fontSize: 10, margin: '2px 3px' }}>{label}</span>
  );

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div
        style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 16, padding: 24, maxWidth: 500, width: '92%', boxShadow: '0 32px 80px rgba(0,0,0,.5)' }}
        onClick={e => e.stopPropagation()}
      >
        <h3 style={{ margin: '0 0 14px', fontSize: 14, fontWeight: 800 }}>
          {t.lang === 'ar' ? 'ملف المستخدم' : 'User Profile'}
        </h3>
        <div style={{ display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {pill(`${t.lang === 'ar' ? 'أول ظهور' : 'First seen'}: ${fmtTs(data.firstSeen, loc)}`)}
            {pill(`${t.lang === 'ar' ? 'عدد تسجيلات الدخول' : 'Login count'}: ${data.loginCount}`)}
            {pill(`${t.lang === 'ar' ? 'الجلسات' : 'Sessions'}: ${data.sessions}`)}
            {email && pill(`Email: ${email}`)}
            {data.uid5 && pill(`User ID: ${data.uid5}`)}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {pill(`${t.lang === 'ar' ? 'آخر دخول' : 'Last login'}: ${fmtTs(data.lastLogin, loc)}`)}
            {pill(`${t.lang === 'ar' ? 'آخر نسخة سحابية' : 'Last cloud backup'}: ${fmtTs(data.lastCloudBackup, loc)}`)}
            {pill(`${t.lang === 'ar' ? 'آخر استعادة سحابية' : 'Last cloud restore'}: ${fmtTs(data.lastCloudRestore, loc)}`)}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {pill(`${t.lang === 'ar' ? 'صفقات' : 'Trades'}: ${data.trades}`)}
            {pill(`${t.lang === 'ar' ? 'دفعات' : 'Batches'}: ${data.batches}`)}
            {pill(`${t.lang === 'ar' ? 'عملاء' : 'Customers'}: ${data.customers}`)}
            {pill(`${t.lang === 'ar' ? 'موردين' : 'Suppliers'}: ${data.suppliers}`)}
            {pill(`State: ${data.stateKB} KB`)}
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <button className="btn secondary" onClick={onClose}>
            {t.lang === 'ar' ? 'إغلاق' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
}
