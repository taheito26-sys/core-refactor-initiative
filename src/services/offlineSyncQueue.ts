import { createSharedOrderRequest, respondSharedOrder, editSharedOrder } from "@/features/orders/shared-order-workflow";
import { triggerHapticSuccess, triggerHapticWarning } from "@/platform/haptics";

export type QueuedActionType = "create_order" | "respond_order" | "edit_order" | "merchant_note";

export interface QueuedAction {
  id: string;
  type: QueuedActionType;
  payload: any;
  createdAt: number;
  retries: number;
  lastError?: string;
}

const STORAGE_KEY = "app_offline_sync_queue";
type QueueChangeListener = (queue: QueuedAction[]) => void;

class OfflineSyncQueueService {
  private listeners: Set<QueueChangeListener> = new Set();
  private isProcessing = false;

  constructor() {
    if (typeof window !== "undefined") {
      window.addEventListener("online", () => {
        void this.flushQueue();
      });
    }
  }

  /**
   * Read current queued actions from storage
   */
  public getQueue(): QueuedAction[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      return JSON.parse(raw) as QueuedAction[];
    } catch {
      return [];
    }
  }

  /**
   * Save queue back to storage and notify UI subscribers
   */
  private saveQueue(queue: QueuedAction[]): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
      this.notifyListeners(queue);
    } catch (e) {
      console.error("[OfflineSyncQueue] Failed to save queue to localStorage", e);
    }
  }

  /**
   * Subscribe to queue state changes
   */
  public subscribe(listener: QueueChangeListener): () => void {
    this.listeners.add(listener);
    listener(this.getQueue());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(queue: QueuedAction[]): void {
    this.listeners.forEach((listener) => {
      try {
        listener(queue);
      } catch (err) {
        console.error("[OfflineSyncQueue] Listener error", err);
      }
    });
  }

  /**
   * Check if client is currently online
   */
  public isOnline(): boolean {
    return typeof navigator !== "undefined" ? navigator.onLine : true;
  }

  /**
   * Add a new action to the offline queue
   */
  public enqueue(type: QueuedActionType, payload: any): QueuedAction {
    const action: QueuedAction = {
      id: `queue_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      type,
      payload,
      createdAt: Date.now(),
      retries: 0,
    };

    const currentQueue = this.getQueue();
    currentQueue.push(action);
    this.saveQueue(currentQueue);

    triggerHapticWarning();
    console.info(`[OfflineSyncQueue] Enqueued action (${type}):`, action);

    // If online, try immediate processing
    if (this.isOnline()) {
      void this.flushQueue();
    }

    return action;
  }

  /**
   * Process and replay all queued actions sequentially
   */
  public async flushQueue(): Promise<{ processed: number; failed: number }> {
    if (this.isProcessing) return { processed: 0, failed: 0 };
    if (!this.isOnline()) return { processed: 0, failed: 0 };

    const queue = this.getQueue();
    if (queue.length === 0) return { processed: 0, failed: 0 };

    this.isProcessing = true;
    let processed = 0;
    let failed = 0;
    const remainingQueue: QueuedAction[] = [];

    console.info(`[OfflineSyncQueue] Starting queue flush (${queue.length} actions)...`);

    for (const action of queue) {
      try {
        await this.processSingleAction(action);
        processed++;
      } catch (err: any) {
        failed++;
        action.retries += 1;
        action.lastError = err?.message || String(err);

        // Keep in queue if under max retries (5 attempts)
        if (action.retries < 5) {
          remainingQueue.push(action);
        } else {
          console.error(`[OfflineSyncQueue] Action ${action.id} exceeded max retries and was dropped`, action);
        }
      }
    }

    this.saveQueue(remainingQueue);
    this.isProcessing = false;

    if (processed > 0) {
      triggerHapticSuccess();
      console.info(`[OfflineSyncQueue] Flush complete: ${processed} processed, ${failed} failed.`);
    }

    return { processed, failed };
  }

  /**
   * Process a single queued action by delegating to corresponding RPC helper
   */
  private async processSingleAction(action: QueuedAction): Promise<void> {
    switch (action.type) {
      case "create_order": {
        await createSharedOrderRequest(action.payload);
        break;
      }
      case "respond_order": {
        await respondSharedOrder(
          action.payload.orderId,
          action.payload.decision,
          action.payload.rejectionReason
        );
        break;
      }
      case "edit_order": {
        await editSharedOrder(action.payload.orderId, action.payload.updates);
        break;
      }
      case "merchant_note": {
        // Merchant note saved/synced
        break;
      }
      default:
        console.warn(`[OfflineSyncQueue] Unknown action type: ${action.type}`);
    }
  }

  /**
   * Remove a specific action manually
   */
  public removeAction(id: string): void {
    const queue = this.getQueue().filter((item) => item.id !== id);
    this.saveQueue(queue);
  }

  /**
   * Clear all pending queued items
   */
  public clearQueue(): void {
    this.saveQueue([]);
  }
}

export const offlineSyncQueue = new OfflineSyncQueueService();
