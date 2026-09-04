import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/features/auth/auth-context';
import { useTheme } from '@/lib/theme-context';
import { supabase } from '@/integrations/supabase/client';
import { extractFunctionErrorMessage } from '@/lib/edge-function-error';
import { PublicStatementReport, type PublicStatement } from '@/features/stock/components/PublicStatementReport';

// Authenticated counterpart to /statements/:token — pulls every loan
// statement a merchant has attached to this customer's portal account
// (buyer_statement_links.customer_user_id) and renders the same
// USDT-free report inline, one tab per currency.
export default function CustomerLoanStatementPage() {
  const { userId } = useAuth();
  const { settings } = useTheme();
  const isRTL = settings.language === 'ar';
  const L = (en: string, ar: string) => (isRTL ? ar : en);

  const [activeCurrency, setActiveCurrency] = useState<string | null>(null);

  const { data, isLoading, isError, error: queryError } = useQuery({
    queryKey: ['c-loan-statements', userId],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('customer-loan-statement', { method: 'GET' });
      if (error || !data || (data as { error?: string }).error) {
        throw new Error(await extractFunctionErrorMessage(error, data, 'fetch failed'));
      }
      return (data as { statements: PublicStatement[] }).statements;
    },
    enabled: !!userId,
  });

  const statements = data ?? [];
  const selected = statements.find(s => s.currency === activeCurrency) ?? statements[0] ?? null;

  return (
    <div dir={isRTL ? 'rtl' : 'ltr'} className="space-y-4">
      <div>
        <h1 className="text-lg font-bold">{L('Loaned Orders', 'الطلبات المؤجّلة')}</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          {L('Your loan balance, EGP order history, and payments — as shared by your merchant.', 'رصيد قرضك وسجل طلبات الجنيه المصري والدفعات — كما شاركها معك التاجر.')}
        </p>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      )}

      {!isLoading && isError && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {L('Could not load your statement.', 'تعذر تحميل كشف الحساب.')}
          {queryError instanceof Error && queryError.message && (
            <div className="mt-1 text-xs opacity-80">{queryError.message}</div>
          )}
        </div>
      )}

      {!isLoading && !isError && statements.length === 0 && (
        <div className="rounded-xl border border-border/50 bg-muted/30 p-6 text-center text-sm text-muted-foreground">
          {L('No loan statement has been shared with you yet.', 'لم يشارك معك أي تاجر كشف قرض حتى الآن.')}
        </div>
      )}

      {!isLoading && !isError && statements.length > 0 && (
        <>
          {statements.length > 1 && (
            <div className="flex gap-1 rounded-lg bg-muted/60 p-1">
              {statements.map(s => (
                <button
                  key={s.currency}
                  onClick={() => setActiveCurrency(s.currency)}
                  className={`flex-1 rounded-md py-1.5 text-xs font-semibold transition-colors ${selected?.currency === s.currency ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'}`}
                >
                  {s.currency}
                </button>
              ))}
            </div>
          )}
          {selected && <PublicStatementReport data={selected} framed={false} />}
        </>
      )}
    </div>
  );
}
