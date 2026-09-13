import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  exportMonthlyStatementPdf,
  exportMonthlyStatementXlsx,
  type MonthlyStatementData,
} from "@/features/stock/utils/monthlyStatementExport";
import { isStaleChunkError, recoverFromStaleChunk } from "@/lib/staleChunkRecovery";

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
      console.error("Monthly statement export failed", format, err);
      // jsPDF/exceljs are dynamically imported by hashed chunk URL; if a new
      // deploy landed since this page loaded, that exact file is gone from
      // the server and the import rejects. Retrying in the same page can't
      // fix it — recover the way RouteErrorBoundary does for render-time
      // chunk failures: clear the stale cache/service worker and reload.
      if (isStaleChunkError(err)) {
        toast.error(L("Updating the app, please try again in a moment…", "جارٍ تحديث التطبيق، حاول مرة أخرى بعد قليل…"));
        await recoverFromStaleChunk();
        return;
      }
      const detail = err instanceof Error ? err.message : String(err);
      toast.error(`${L("Could not generate the statement", "تعذر إنشاء البيان")}: ${detail}`, { duration: 15000 });
    } finally {
      setExportingFormat(null);
    }
  };

  return { exportingFormat, exportStatement };
}
