import { useNavigate } from "react-router-dom";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useMarkNotificationRead } from "@/hooks/useNotifications";
import type { AppNotification } from "@/types/notifications";
import type { Lang } from "../route";
export function DriverNotifications({
  open,
  onClose,
  lang,
  notifications,
}: {
  open: boolean;
  onClose: () => void;
  lang: Lang;
  notifications: AppNotification[];
}) {
  const navigate = useNavigate();
  const mark = useMarkNotificationRead();
  const items = notifications.filter((n) => n.entity_type === "shipment");
  return (
    <Sheet
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <SheetContent
        side={lang === "ar" ? "left" : "right"}
        className="p-0 border-0 overflow-y-auto"
      >
        <div
          className="ch-root co-root cs-sheet"
          dir={lang === "ar" ? "rtl" : "ltr"}
        >
          <SheetHeader className="cs-dh">
            <SheetTitle>
              {lang === "ar" ? "تنبيهات الرحلات" : "Trip notifications"}
            </SheetTitle>
            <SheetDescription>
              {lang === "ar"
                ? "مواعيد القراءات وتنبيهات الحرارة وموافقات الاستئناف"
                : "Reading deadlines, temperature alerts and restart approvals"}
            </SheetDescription>
          </SheetHeader>
          <div className="cs-dbody">
            {!items.length && (
              <p>
                {lang === "ar"
                  ? "لا توجد تنبيهات بعد."
                  : "No notifications yet."}
              </p>
            )}
            {items.map((n) => (
              <button
                key={n.id}
                className={`ch-card cs-box cs-notification ${n.read_at ? "" : "unread"}`}
                onClick={() => {
                  mark.mutate(n.id);
                  onClose();
                  navigate(
                    n.target_path?.startsWith("/d/")
                      ? n.target_path
                      : n.entity_id
                        ? `/d/shipments/${encodeURIComponent(n.entity_id)}`
                        : "/d/shipments",
                  );
                }}
              >
                <b>{n.title}</b>
                <p>{n.body}</p>
                <small>
                  {new Date(n.created_at).toLocaleString(
                    lang === "ar" ? "ar-EG" : "en-GB",
                  )}
                </small>
              </button>
            ))}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
