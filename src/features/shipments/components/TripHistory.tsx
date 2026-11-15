import { durationLabel, type Lang } from "../route";
import { activeTripMs, approvalWaitMs } from "../timing";
import type { Shipment } from "../types";
const labels = {
  created: ["Shipment created", "أُنشئت الشحنة"],
  started: ["Driver started", "بدأ السائق الرحلة"],
  ended_early: ["Driver ended early", "أنهى السائق الرحلة مبكرًا"],
  restart_approved: ["Client approved restart", "وافق العميل على الاستئناف"],
  delivered: ["Delivery confirmed", "تأكد التسليم"],
  cancelled: ["Shipment cancelled", "أُلغيت الشحنة"],
  arrival: ["Arrival confirmed", "تأكد الوصول"],
  legacy: ["Earlier history unavailable", "السجل السابق غير متاح"],
};
export function TripHistory({
  shipment,
  now,
  lang,
}: {
  shipment: Shipment;
  now: number;
  lang: Lang;
}) {
  const events = [...(shipment.events ?? [])].sort(
    (a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at),
  );
  const active = activeTripMs(shipment, now);
  const waiting = approvalWaitMs(
    shipment.events,
    now,
    shipment.status === "ended_early" ? shipment.ended_at : null,
  );
  return (
    <details className="ch-card cs-box cs-history">
      <summary>
        {lang === "ar" ? "سجل الرحلة والاستئناف" : "Trip and restart history"}
      </summary>
      <p>
        {lang === "ar" ? "وقت فعلي: " : "Active time: "}
        {active === null ? "—" : durationLabel(active, lang)} ·{" "}
        {lang === "ar" ? "انتظار الموافقة: " : "Awaiting approval: "}
        {durationLabel(waiting, lang)}
      </p>
      {!events.length && (
        <p>
          {lang === "ar"
            ? "لا يوجد سجل أحداث سابق لهذه الرحلة."
            : "No earlier event history is available for this trip."}
        </p>
      )}
      <ol>
        {events.map((e) => (
          <li key={e.id}>
            <b>{labels[e.event_type][lang === "ar" ? 1 : 0]}</b>
            <time>
              {new Date(e.occurred_at).toLocaleString(
                lang === "ar" ? "ar-EG" : "en-GB",
              )}
            </time>
            {e.event_type === "arrival" && (
              <span>
                {lang === "ar"
                  ? (e.details.stop_ar ?? e.details.stop)
                  : e.details.stop}{" "}
                ·{" "}
                {e.details.method === "gps"
                  ? lang === "ar"
                    ? "تأكد بالموقع"
                    : "GPS verified"
                  : lang === "ar"
                    ? "تأكيد بتوضيح السائق"
                    : "Driver override"}
              </span>
            )}
            {e.details.reason && <p>{e.details.reason}</p>}
          </li>
        ))}
      </ol>
    </details>
  );
}
