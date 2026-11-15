import { useEffect, useState } from "react";
import { toast } from "sonner";
import { durableReadingStorage } from "../reading-outbox";
import { useReadingUploads } from "../useReadingOutbox";
import { formatStampTime } from "../geo";
import type { Lang } from "../route";
function SavedPhoto({ photo, lang }: { photo: Blob; lang: Lang }) {
 const [url,setUrl]=useState('');
 useEffect(()=>{const next=URL.createObjectURL(photo);setUrl(next);return()=>URL.revokeObjectURL(next)},[photo]);
 return url ? <img src={url} alt={lang === "ar" ? "الصورة المحفوظة للحرارة" : "Saved temperature proof"} loading="lazy" className="cs-queued-photo" /> : null;
}
export function ReadingUploads({ lang }: { lang: Lang }) {
  const L = (en: string, ar: string) => (lang === "ar" ? ar : en);
  const { items, retry, discard, storageError } = useReadingUploads();
  const [busy, setBusy] = useState<string | null>(null);
  if (!items.length && !storageError) return null;
  return (
    <section
      className="ch-card cs-box cs-upload-list"
      aria-label={L("Pending reading uploads", "القراءات بانتظار الرفع")}
    >
      <h3>
        {L("Pending reading uploads", "القراءات بانتظار الرفع")}{" "}
        <small>{items.length}</small>
      </h3>
      <p className="cs-sampling-note">{L("Saved photos retry when the app is open and online.", "تُعاد محاولة الصور المحفوظة عندما يكون التطبيق مفتوحًا ومتصلًا.")}</p>
      {storageError && (
        <p role="alert">
          {L(
            "Device storage is unavailable. Keep this page open and retry; do not close it before sending.",
            "تخزين الجهاز غير متاح. أبقِ الصفحة مفتوحة وأعد المحاولة، ولا تغلقها قبل الإرسال.",
          )}
        </p>
      )}
      {!durableReadingStorage() && (
        <p>
          {L(
            "Photos can only be kept in this tab on this browser.",
            "لا يمكن حفظ الصور إلا في علامة التبويب الحالية بهذا المتصفح.",
          )}
        </p>
      )}
      {items.map((item) => (
        <div key={item.id} className="cs-upload-item">
          <b dir="ltr">{item.input.temperatureC}°C</b>
          <small>{formatStampTime(item.input.capturedAt)}</small>
          <strong role="status">
            {item.status === "uploading"
              ? L("Uploading…", "جارٍ الرفع…")
              : item.status === "waiting"
                ? L(
                    "Saved on this device — waiting for connection",
                    "محفوظة على هذا الجهاز — بانتظار الاتصال",
                  )
                : L("Upload failed — photo kept", "فشل الرفع — الصورة محفوظة")}
          </strong>
          <details><summary>{L('View saved photo', 'عرض الصورة المحفوظة')}</summary><SavedPhoto photo={item.input.photo} lang={lang} /></details>
          {item.error && <p>{L("Check the connection or the trip status before retrying. Your photo is kept.", "تحقق من الاتصال أو حالة الرحلة قبل إعادة المحاولة. صورتك محفوظة.")}</p>}
          <div className="cs-with">
            <button
              className="co-btn"
              disabled={busy !== null || item.status === "uploading"}
              onClick={async () => {
                setBusy(item.id);
                try {
                  await retry(item.id);
                  toast.success(L("Reading sent", "تم إرسال القراءة"));
                } catch (e) {
                  toast.error((e as Error).message);
                } finally {
                  setBusy(null);
                }
              }}
            >
              {L("Retry", "إعادة المحاولة")}
            </button>
            <button
              className="co-btn bad"
              disabled={busy !== null || item.status === "uploading"}
              onClick={() => {
                if (
                  window.confirm(
                    L(
                      "Discard this unsent photo and reading?",
                      "هل تريد حذف هذه الصورة والقراءة غير المرسلة؟",
                    ),
                  )
                )
                  void discard(item.id);
              }}
            >
              {L("Discard", "حذف")}
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}
