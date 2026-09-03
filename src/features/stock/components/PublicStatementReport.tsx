import type { CSSProperties } from 'react';

export interface PublicPayment {
  date: number;
  amount: number;
  note: string | null;
  ref: string | null;
}

export interface PublicOrder {
  ref: string;
  date: number;
  amount: number;
  paid: number;
  remaining: number;
  settled: boolean;
  note: string | null;
}

export interface PublicBinanceOrder {
  orderNumber: string;
  date: string | number | null;
  counterparty: string | null;
  exchange: string;
  fiat: string;
  fiatAmount: number;
  fiatPrice: number;
  /** Omitted server-side on the public /statements/:token path — never shown to a buyer. */
  usdtAmount?: number;
  /** Omitted server-side on the public /statements/:token path — never shown to a buyer. */
  qarRate?: number;
  qarAmount: number;
}

export interface PublicStatement {
  customerName: string;
  currency: string;
  totalLoaned: number;
  totalRepaid: number;
  outstanding: number;
  issueDate: string;
  orders: PublicOrder[];
  payments: PublicPayment[];
  binanceOrders?: PublicBinanceOrder[];
}

// en → code as-is, ar → the abbreviation used on printed statements.
// Explicit map (not the app's currency-locale helper) so this stays usable
// from a context with no i18n/theme provider, like the public page.
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

/**
 * The buyer statement report body — totals, orders, payments — as its own
 * component so it renders identically whether it's the standalone public
 * page at /statements/:token or an inline preview inside Cash Management.
 * Same sanitized shape either way: whatever the edge function returned.
 */
export function PublicStatementReport({ data, framed = true }: { data: PublicStatement; framed?: boolean }) {
  const cur = currencySuffix(data.currency);
  const repaidPct = data.totalLoaned > 0 ? Math.min(100, Math.round((data.totalRepaid / data.totalLoaned) * 100)) : 0;
  const paymentsTotal = data.payments.reduce((sum, p) => sum + p.amount, 0);

  const body = (
    <>
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

      {/* ── SECTION B (orders) ── */}
      <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8 }}>
        سجل الطلبات ({data.orders.length} طلب)
      </div>
      <div style={{ overflowX: 'auto', marginBottom: 24 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #ddd' }}>
              <th style={thStyle}>المرجع</th>
              <th style={thStyle}>التاريخ</th>
              <th style={{ ...thStyle, textAlign: 'left' }}>{`المبلغ (${cur})`}</th>
              <th style={{ ...thStyle, textAlign: 'left' }}>{`المسدد (${cur})`}</th>
              <th style={{ ...thStyle, textAlign: 'left' }}>{`المتبقي (${cur})`}</th>
              <th style={thStyle}>الحالة</th>
            </tr>
          </thead>
          <tbody>
            {data.orders.map((o, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #eee' }}>
                <td style={tdStyle}>{o.ref}</td>
                <td style={tdStyle}>{fmtDate(o.date)}</td>
                <td style={{ ...tdStyle, textAlign: 'left', fontWeight: 700 }}>{fmtAmount(o.amount)}</td>
                <td style={{ ...tdStyle, textAlign: 'left' }}>{fmtAmount(o.paid)}</td>
                <td style={{ ...tdStyle, textAlign: 'left' }}>{fmtAmount(o.remaining)}</td>
                <td style={tdStyle}>
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
                    background: o.settled ? '#e6f4ea' : '#fdeaea',
                    color: o.settled ? '#1a7a3c' : '#b3261e',
                  }}>
                    {o.settled ? 'مسدد' : 'مفتوح'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── SECTION C (payments) ── */}
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

      {/* ── SECTION D (Binance P2P sell orders) ── */}
      {data.binanceOrders && data.binanceOrders.length > 0 && (() => {
        // usdtAmount/qarRate are only present when the caller opted into the
        // full internal view — the public token page never receives them, so
        // those two columns simply don't exist to render here.
        const showUsdt = data.binanceOrders.every(o => o.usdtAmount != null);
        const showRate = data.binanceOrders.every(o => o.qarRate != null);
        return (
        <>
          <div style={{ fontSize: 13, fontWeight: 800, marginTop: 24, marginBottom: 8 }}>
            سجل معاملات البيع مقابل الجنيه المصري ({data.binanceOrders.length} معاملة)
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #ddd' }}>
                  <th style={thStyle}>#</th>
                  <th style={thStyle}>رقم الطلب</th>
                  <th style={thStyle}>الطرف الآخر</th>
                  <th style={thStyle}>التاريخ</th>
                  <th style={{ ...thStyle, textAlign: 'left' }}>{`المبلغ (${data.binanceOrders[0].fiat})`}</th>
                  <th style={{ ...thStyle, textAlign: 'left' }}>{`السعر (${data.binanceOrders[0].fiat}/USDT)`}</th>
                  {showUsdt && <th style={{ ...thStyle, textAlign: 'left' }}>USDT</th>}
                  {showRate && <th style={{ ...thStyle, textAlign: 'left' }}>{`سعر التحويل (${cur}/USDT)`}</th>}
                  <th style={{ ...thStyle, textAlign: 'left' }}>{`المعادل (${cur})`}</th>
                </tr>
              </thead>
              <tbody>
                {data.binanceOrders.map((o, i) => (
                  <tr key={o.orderNumber} style={{ borderBottom: '1px solid #eee' }}>
                    <td style={tdStyle}>{i + 1}</td>
                    <td style={{ ...tdStyle, fontSize: 10, color: '#888' }}>{o.orderNumber}</td>
                    <td style={tdStyle}>{o.counterparty || '—'}</td>
                    <td style={tdStyle}>{fmtDate(o.date ?? '')}</td>
                    <td style={{ ...tdStyle, textAlign: 'left' }}>{fmtAmount(o.fiatAmount)}</td>
                    <td style={{ ...tdStyle, textAlign: 'left' }}>{o.fiatPrice.toFixed(2)}</td>
                    {showUsdt && <td style={{ ...tdStyle, textAlign: 'left' }}>{fmtAmount(o.usdtAmount ?? 0)}</td>}
                    {showRate && <td style={{ ...tdStyle, textAlign: 'left' }}>{(o.qarRate ?? 0).toFixed(2)}</td>}
                    <td style={{ ...tdStyle, textAlign: 'left', fontWeight: 700 }}>{fmtAmount(o.qarAmount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td style={tdStyle} colSpan={4}>الإجمالي</td>
                  <td style={{ ...tdStyle, textAlign: 'left', fontWeight: 800 }}>
                    {fmtAmount(data.binanceOrders.reduce((s, o) => s + o.fiatAmount, 0))}
                  </td>
                  <td style={tdStyle} />
                  {showUsdt && (
                    <td style={{ ...tdStyle, textAlign: 'left', fontWeight: 800 }}>
                      {fmtAmount(data.binanceOrders.reduce((s, o) => s + (o.usdtAmount ?? 0), 0))}
                    </td>
                  )}
                  {showRate && <td style={tdStyle} />}
                  <td style={{ ...tdStyle, textAlign: 'left', fontWeight: 800 }}>
                    {fmtAmount(data.binanceOrders.reduce((s, o) => s + o.qarAmount, 0))}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
        );
      })()}

      <div style={{ fontSize: 10, color: '#aaa', marginTop: 24, textAlign: 'center' }}>
        هذا البيان صادر إلكترونياً ويعكس آخر تسوية معتمدة على النظام بتاريخ الإصدار أعلاه.
      </div>
    </>
  );

  if (!framed) return <div dir="rtl" style={{ fontFamily: "'Tahoma', 'Segoe UI', sans-serif", color: '#111' }}>{body}</div>;

  return (
    <div dir="rtl" style={cardStyle}>
      {body}
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

const cardStyle: CSSProperties = {
  maxWidth: 720,
  margin: '0 auto',
  background: '#fff',
  borderRadius: 12,
  padding: '24px 20px',
  boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
  fontFamily: "'Tahoma', 'Segoe UI', sans-serif",
  color: '#111',
};

const thStyle: CSSProperties = { textAlign: 'right', padding: '6px 8px', color: '#888', fontWeight: 700, fontSize: 11 };
const tdStyle: CSSProperties = { padding: '6px 8px' };
