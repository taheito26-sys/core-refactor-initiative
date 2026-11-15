import { Route as RouteIcon } from "lucide-react";
import { stopName, stopProgress, type Lang } from "../route";
import type { ShipmentStatus, ShipmentStop } from "../types";
import { RouteList } from "./RouteList";
export function RouteSummary({
  stops,
  status,
  lang,
}: {
  stops: ShipmentStop[];
  status: ShipmentStatus;
  lang: Lang;
}) {
  const p = stopProgress(stops);
  return (
    <details className="ch-card cs-box cs-route-summary">
      <summary>
        <RouteIcon aria-hidden="true" />
        <b>{lang === "ar" ? "المسار" : "Route"}</b>
        <span dir="ltr">
          {p.reachedCount}/{p.total}
        </span>
        {p.next && (
          <span>
            {lang === "ar" ? "المحطة التالية: " : "Next: "}
            {stopName(p.next, lang)}
          </span>
        )}
        <small><span className="route-expand">{lang === "ar" ? "عرض المسار" : "Expand route"}</span><span className="route-collapse">{lang === "ar" ? "طي المسار" : "Collapse route"}</span></small>
      </summary>
      <RouteList stops={stops} status={status} lang={lang} />
    </details>
  );
}
