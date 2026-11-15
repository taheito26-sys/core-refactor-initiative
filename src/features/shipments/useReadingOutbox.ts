import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/features/auth/auth-context";
import {
  discardQueuedReading,
  flushReadingOutbox,
  listQueuedReadings,
  sendQueuedReading,
  UPLOAD_EVENT,
  type QueuedReading,
} from "./reading-outbox";
export function useReadingUploads() {
  const { userId } = useAuth();
  const qc = useQueryClient();
  const [items, setItems] = useState<QueuedReading[]>([]);
  const [storageError, setStorageError] = useState(false);
  const refresh = useCallback(async () => {
    if (!userId) {
      setItems([]);
      return;
    }
    try {
      setItems(await listQueuedReadings(userId));
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  }, [userId]);
  useEffect(() => {
    void refresh();
    const listener = () => {
      void refresh();
    };
    window.addEventListener(UPLOAD_EVENT, listener);
    return () => window.removeEventListener(UPLOAD_EVENT, listener);
  }, [refresh]);
  return {
    items,
    storageError,
    retry: async (id: string) => {
      if (!userId) return;
      try {
        await sendQueuedReading(userId, id);
        await qc.invalidateQueries({ queryKey: ["shipments"] });
      } finally {
        await refresh();
      }
    },
    discard: async (id: string) => {
      if (userId) await discardQueuedReading(userId, id);
    },
  };
}
export function useReadingOutboxWorker(lang: "en" | "ar" = "en") {
  const { userId } = useAuth();
  const qc = useQueryClient();
  useEffect(() => {
    if (!userId) return;
    let active = true;
    const flush = async (force = false) => {
      try {
        const count = await flushReadingOutbox(userId, force);
        if (active && count) {
          await qc.invalidateQueries({ queryKey: ["shipments"] });
          toast.success(lang === "ar" ? `تم إرسال ${count} قراءة محفوظة` : `${count} saved reading(s) sent`);
        }
      } catch {
        /* Pending photos stay local when storage is unavailable. */
      }
    };
    void flush();
    const online = () => {
      void flush(true);
    };
    const timer = setInterval(() => {
      void flush();
    }, 30_000);
    window.addEventListener("online", online);
    window.addEventListener("focus", online);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("online", online);
      window.removeEventListener("focus", online);
    };
  }, [userId, qc, lang]);
}
