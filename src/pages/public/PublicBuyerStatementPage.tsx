import { useEffect, useState, type CSSProperties } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';

interface PublicPayment {
  date: number;
  amount: number;
  note: string | null;
  ref: string | null;
}

interface PublicStatement {
  customerName: string;
  currency: string;
  totalLoaned: number;
  totalRepaid: number;
  outstanding: number;
  issueDate: string;
  payments: PublicPayment[];
}

// en → code as-is, ar → the abbreviation used on printed statements.
// Explicit map (not the app's currency-locale helper) because this page has
// no i18n/theme context — it is a standalone, unauthenticated document.
const CURRENCY_SUFFIX: Record<string, string> = {
  QAR: 'ر.ق',
  EGP: 'ج.م',
  AED: 'د.إ',
  SAR: 'ر.س',
};

function currencySuffix(code: string): string {
  return CURRENCY_SUFFIX[code] || code;
}

function fmtAmount(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

function fmtDate(value: number | string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('ar-EG', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

type LoadState =
  | { status: 'loading' }
  | { status: 'not_found' }
  | { status: 'error' }
  | { status: 'ready'; data: PublicStatement };

export default function PublicBuyerStatementPage() {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    if (!token) { setState({ status: 'not_found' }); return; }

    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke(
          `public-buyer-statement?token=${encodeURIComponent(token)}`,
          { method: 'GET' },
        );
        if (cancelled) return;
        if (error || !data || (data as { error?: string }).error) {
          setState({ status: 'not_found' });
          return;
        }
        setState({ status: 'ready', data: data as PublicStatement });
      } catch {
        if (!cancelled) setState({ status: 'error' });
      }
    })();

    return () => { cancelled = true; };
  }, [token]);

  if (state.status === 'loading') {
    return (
      <div dir="rtl" style={pageStyle}>
        <div style={{ padding: 40, textAlign: 'center', color: '#666' }}>...جارٍ التحميل</div>
      </div>
    );
  }

  if (state.status !== 'ready') {
    return (
      <div dir="rtl" style={pageStyle}>
        <div style={{ padding: 40, textAlign: 'center', color: '#666' }}>
          الرابط غير صالح أو تم إلغاؤه
        </div>
      </div>
    );
  }

  const { data } = state;
  const cur = currencySuffix(data.currency);
  const repaidPct = data.totalLoaned > 0 ? Math.min(100, Math.round((data.totalRepaid / data.totalLoaned) * 100)) : 0;
  const paymentsTotal = data.payments.reduce((sum, p) => sum + p.amount, 0);

  return (
    <div dir="rtl" style={pageStyle}>
      <div style={cardStyle}>
        {/* ── SECTION A ── */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 12, color: '#888' }}>تاريخ الإصدار: {data.issueDate}</div>
          <div style={{ fontSize: 20, fontWeight: 800, marginTop: 4 }}>{data.customerName}</div>
          <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>كشف حساب — جميع الطلبات والدفعات حتى تاريخ الإصدار</div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 12 }}>
          <StatCard label="إجمالي المستحقات" value={data.totalLoaned} cur={cur} />
          <StatCard label="إجمالي المدفوع" value={data.totalRepaid} cur={cur} tone="good" />
          <StatCard label="الرصيد المتبقي" value={data.outstanding} cur={cur} tone={data.outstanding > 0 ? 'bad' : 'good'} />
        </div>

        <div style={{ marginBottom: 28 }}>
          <div style={{ height: 8, borderRadius: 4, background: '#eee', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${repaidPct}%`, background: '#1a7a3c', borderRadius: 4 }} />
          </div>
          <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>{repaidPct}% من المستحقات تم سدادها</div>
        </div>

        {/* ── SECTION B ── */}
        <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8 }}>
          سجل الدفعات المستلمة ({data.payments.length} دفعة)
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #ddd' }}>
                <th style={thStyle}>#</th>
                <th style={thStyle}>التاريخ</th>
                <th style={{ ...thStyle, textAlign: 'left' }}>{`المبلغ (${cur})`}</th>
                <th style={thStyle}>مقابل</th>
                <th style={thStyle}>المرجع</th>
              </tr>
            </thead>
            <tbody>
              {data.payments.map((p, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={tdStyle}>{i + 1}</td>
                  <td style={tdStyle}>{fmtDate(p.date)}</td>
                  <td style={{ ...tdStyle, textAlign: 'left', fontWeight: 700 }}>{fmtAmount(p.amount)}</td>
                  <td style={tdStyle}>{p.note || '—'}</td>
                  <td style={tdStyle}>{p.ref || '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td style={tdStyle} />
                <td style={tdStyle} />
                <td style={{ ...tdStyle, textAlign: 'left', fontWeight: 800 }}>{fmtAmount(paymentsTotal)}</td>
                <td style={{ ...tdStyle, fontWeight: 800 }} colSpan={2}>الإجمالي</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div style={{ fontSize: 10, color: '#aaa', marginTop: 24, textAlign: 'center' }}>
          هذا البيان صادر إلكترونياً ويعكس آخر تسوية معتمدة على النظام بتاريخ الإصدار أعلاه.
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, cur, tone }: { label: string; value: number; cur: string; tone?: 'good' | 'bad' }) {
  const color = tone === 'good' ? '#1a7a3c' : tone === 'bad' ? '#b3261e' : '#111';
  return (
    <div style={{ border: '1px solid #eee', borderRadius: 10, padding: '10px 12px', background: '#fafafa' }}>
      <div style={{ fontSize: 10, color: '#888', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color, marginTop: 4 }}>
        {fmtAmount(value)} <span style={{ fontSize: 11, fontWeight: 600, color: '#888' }}>{cur}</span>
      </div>
    </div>
  );
}

const pageStyle: CSSProperties = {
  minHeight: '100vh',
  background: '#f4f4f5',
  padding: '24px 12px',
  fontFamily: "'Tahoma', 'Segoe UI', sans-serif",
  color: '#111',
};

const cardStyle: CSSProperties = {
  maxWidth: 720,
  margin: '0 auto',
  background: '#fff',
  borderRadius: 12,
  padding: '24px 20px',
  boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
};

const thStyle: CSSProperties = { textAlign: 'right', padding: '6px 8px', color: '#888', fontWeight: 700, fontSize: 11 };
const tdStyle: CSSProperties = { padding: '6px 8px' };
