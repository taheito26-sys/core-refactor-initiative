import { useEffect, useState } from "react";
import { Loader2, MapPin, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { assessArrival } from "../arrival";
import { getFix } from "../location";
import { useReachStop } from "../hooks";
import type { Fix } from "../geo";
import { stopName, type Lang } from "../route";
import type { ShipmentStop } from "../types";
export function ArrivalDialog({
  stop,
  lang,
  onClose,
}: {
  stop: ShipmentStop;
  lang: Lang;
  onClose: () => void;
}) {
  const L = (en: string, ar: string) => (lang === "ar" ? ar : en);
  const [fix, setFix] = useState<Fix | null>(null),
    [checking, setChecking] = useState(true),
    [reason, setReason] = useState("");
  const arrival = useReachStop();
  useEffect(() => {
    let active = true;
    setChecking(true); setFix(null); setReason("");
    const timer = setTimeout(() => { if (active) setChecking(false); }, 10000);
    getFix({ timeoutMs: 10000, maxAgeMs: 30000, highAccuracy: true })
      .then((f) => {
        if (active) setFix(f);
      })
      .catch(() => {})
      .finally(() => {
        clearTimeout(timer);
        if (active) setChecking(false);
      });
    return () => {
      active = false; clearTimeout(timer);
    };
  }, [stop.id]);
  const assessment = assessArrival(stop, fix, Date.now());
  const canConfirm =
    !checking &&
    (assessment.verified ||
      (reason.trim().length >= 8 && reason.trim().length <= 300));
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !arrival.isPending) onClose();
      }}
    >
      <AlertDialogContent
        className="ch-root co-root cs-confirm"
        dir={lang === "ar" ? "rtl" : "ltr"}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>
            {L("Confirm arrival", "تأكيد الوصول")}: {stopName(stop, lang)}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {L(
              "Your confirmation method and any explanation are visible to the client.",
              "يرى العميل طريقة التأكيد وأي توضيح تقدمه.",
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {checking ? (
          <p role="status">
            <Loader2 className="animate-spin" />
            {L("Checking your GPS…", "جارٍ التحقق من موقعك…")}
          </p>
        ) : assessment.verified ? (
          <p className="cs-banner ok">
            <MapPin />
            {L(
              "GPS matches the expected stop area.",
              "الموقع يطابق منطقة المحطة المتوقعة.",
            )}
          </p>
        ) : (
          <div className="cs-banner warn" role="alert">
            <TriangleAlert />
            <div>
              <b>
                {assessment.issue === "far"
                  ? L(
                      `You appear ${Math.round(assessment.distanceKm ?? 0)} km from the expected stop.`,
                      `تبدو على بعد ${Math.round(assessment.distanceKm ?? 0)} كم من المحطة.`,
                    )
                  : assessment.issue === "no_area"
                    ? L(
                        "No exact stop area is configured; GPS cannot verify this stop.",
                        "لم تُحدد منطقة دقيقة لهذه المحطة، ولا يمكن تأكيدها بالموقع.",
                      )
                    : L(
                        "GPS is unavailable, old or too imprecise to verify arrival.",
                        "الموقع غير متاح أو قديم أو غير دقيق لتأكيد الوصول.",
                      )}
              </b>
              <label className="cs-field">
                {L(
                  "Explain why you are confirming this arrival (8–300 characters)",
                  "وضح سبب تأكيد الوصول (٨–٣٠٠ حرف)",
                )}
                <textarea
                  value={reason}
                  maxLength={300}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
            </div>
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={arrival.isPending}>
            {L("Back", "رجوع")}
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={!canConfirm || arrival.isPending}
            onClick={(e) => {
              e.preventDefault();
              if (!canConfirm) return;
              arrival.mutate(
                { stopId: stop.id, fix, reason },
                {
                  onSuccess: onClose,
                  onError: (err) => toast.error((err as Error).message),
                },
              );
            }}
          >
            {arrival.isPending
              ? L("Confirming…", "جارٍ التأكيد…")
              : L("Confirm arrival", "تأكيد الوصول")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
