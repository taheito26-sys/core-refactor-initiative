import { useEffect, useState, type CSSProperties } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { PublicStatementReport, type PublicStatement } from '@/features/stock/components/PublicStatementReport';

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

  return (
    <div dir="rtl" style={pageStyle}>
      <PublicStatementReport data={state.data} />
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
