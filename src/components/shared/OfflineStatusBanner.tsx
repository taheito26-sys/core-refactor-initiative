import React, { useEffect, useState } from "react";
import { WifiOff, RefreshCw, CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { offlineSyncQueue, QueuedAction } from "@/services/offlineSyncQueue";
import { triggerHapticImpactLight } from "@/platform/haptics";

export function OfflineStatusBanner() {
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== "undefined" ? navigator.onLine : true
  );
  const [queue, setQueue] = useState<QueuedAction[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    const unsubscribe = offlineSyncQueue.subscribe((updatedQueue) => {
      setQueue(updatedQueue);
    });

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      unsubscribe();
    };
  }, []);

  const handleManualSync = async () => {
    triggerHapticImpactLight();
    setIsSyncing(true);
    try {
      await offlineSyncQueue.flushQueue();
    } finally {
      setIsSyncing(false);
    }
  };

  // If online and no queued items, don't display banner
  if (isOnline && queue.length === 0) {
    return null;
  }

  return (
    <div className="fixed top-3 right-3 z-[150] flex max-w-md items-center gap-3 rounded-lg border border-border/80 bg-background/95 p-3 text-xs shadow-lg backdrop-blur transition-all duration-300">
      {!isOnline ? (
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400">
          <WifiOff className="h-4 w-4 animate-pulse" />
        </div>
      ) : (
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/15 text-primary">
          <AlertTriangle className="h-4 w-4" />
        </div>
      )}

      <div className="flex-1">
        <div className="font-semibold text-foreground">
          {!isOnline ? "Working Offline" : `${queue.length} Pending Offline Action${queue.length > 1 ? "s" : ""}`}
        </div>
        <div className="text-[11px] text-muted-foreground">
          {!isOnline
            ? queue.length > 0
              ? `${queue.length} action(s) queued for auto-sync`
              : "Order changes will be queued locally"
            : "Reconnected. Ready to sync queued changes"}
        </div>
      </div>

      {queue.length > 0 && isOnline && (
        <Button
          size="sm"
          variant="outline"
          onClick={handleManualSync}
          disabled={isSyncing}
          className="h-7 text-[11px] font-medium"
        >
          <RefreshCw className={`mr-1 h-3 w-3 ${isSyncing ? "animate-spin" : ""}`} />
          {isSyncing ? "Syncing..." : "Sync Now"}
        </Button>
      )}
    </div>
  );
}
export default OfflineStatusBanner;
