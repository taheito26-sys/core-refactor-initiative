import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  exportMonthlyStatementPdf,
  exportMonthlyStatementXlsx,
  type MonthlyStatementData,
} from "@/features/stock/utils/monthlyStatementExport";

/**
 * Fetches the branded, month-scoped buyer statement from the
 * customer-monthly-statement edge function and saves it locally as a real
 * PDF or XLSX file — no print dialog. Shared by the customer Orders page
 * and the customer Cash (Payments) page so both offer the same export.
 */
export function useMonthlyStatementExport(currency: string, L: (en: string, ar: string) => string) {
  const [exportingFormat, setExportingFormat] = useState<"pdf" | "xlsx" | null>(null);

  const fetchStatement = async (month: string): Promise<MonthlyStatementData | null> => {
    const { data, error } = await supabase.functions.invoke(
      `customer-monthly-statement?month=${encodeURIComponent(month)}&currency=${encodeURIComponent(currency)}`,
      { method: "GET" },
    );
    if (error || !data || (data as { error?: string }).error) {
      toast.error(L("Could not generate the statement", "تعذر إنشاء البيان"));
      return null;
    }
    const statements = (data as { statements: MonthlyStatementData[] }).statements;
    const statement = statements[0];
    if (!statement) {
      toast.error(L("No statement found for this month", "لا يوجد بيان لهذا الشهر"));
      return null;
    }
    return statement;
  };

  const exportStatement = async (month: string | null, availableMonths: string[], format: "pdf" | "xlsx") => {
    const targetMonth = month || availableMonths[0];
    if (!targetMonth) {
      toast.error(L("No activity to export yet", "لا يوجد نشاط لتصديره بعد"));
      return;
    }
    setExportingFormat(format);
    try {
      const statement = await fetchStatement(targetMonth);
      if (!statement) return;
      if (format === "pdf") await exportMonthlyStatementPdf(statement);
      else await exportMonthlyStatementXlsx(statement);
    } catch (err) {
      // Logged rather than swallowed: the toast alone gives no way to tell
      // a PDF-rasterization failure apart from a network error, and past
      // reports of "PDF export not working" had no way to be diagnosed
      // without this surfacing in the console.
      console.error("Monthly statement export failed", format, err);
      toast.error(L("Could not generate the statement", "تعذر إنشاء البيان"));
    } finally {
      setExportingFormat(null);
    }
  };

  return { exportingFormat, exportStatement };
}
