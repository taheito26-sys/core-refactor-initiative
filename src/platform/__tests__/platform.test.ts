import { describe, it, expect, beforeEach, vi } from "vitest";
import { HapticService } from "@/platform/haptics";
import { BiometricsService } from "@/platform/biometrics";
import { offlineSyncQueue } from "@/services/offlineSyncQueue";

describe("Platform & Native Services", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  describe("HapticService", () => {
    it("runs haptic triggers without throwing", async () => {
      await expect(HapticService.triggerSuccess()).resolves.not.toThrow();
      await expect(HapticService.triggerWarning()).resolves.not.toThrow();
      await expect(HapticService.triggerError()).resolves.not.toThrow();
      await expect(HapticService.triggerSelection()).resolves.not.toThrow();
      await expect(HapticService.triggerImpactMedium()).resolves.not.toThrow();
    });
  });

  describe("BiometricsService", () => {
    it("persists and reads biometrics toggle settings", () => {
      expect(BiometricsService.isBiometricsEnabled()).toBe(false);

      BiometricsService.setBiometricsEnabled(true);
      expect(BiometricsService.isBiometricsEnabled()).toBe(true);

      BiometricsService.setBiometricsEnabled(false);
      expect(BiometricsService.isBiometricsEnabled()).toBe(false);
    });

    it("persists and reads high-value transfer threshold", () => {
      expect(BiometricsService.getHighValueThreshold()).toBe(1000);

      BiometricsService.setHighValueThreshold(2500);
      expect(BiometricsService.getHighValueThreshold()).toBe(2500);
    });

    it("evaluates shouldRequireBiometrics based on state and threshold", () => {
      BiometricsService.setBiometricsEnabled(false);
      expect(BiometricsService.shouldRequireBiometrics(5000)).toBe(false);

      BiometricsService.setBiometricsEnabled(true);
      BiometricsService.setHighValueThreshold(1000);
      expect(BiometricsService.shouldRequireBiometrics(500)).toBe(false);
      expect(BiometricsService.shouldRequireBiometrics(1500)).toBe(true);
    });
  });

  describe("OfflineSyncQueueService", () => {
    it("enqueues actions and retrieves queued items", () => {
      expect(offlineSyncQueue.getQueue()).toHaveLength(0);

      const item = offlineSyncQueue.enqueue("respond_order", {
        orderId: "ord_123",
        decision: "approve",
      });

      expect(item.type).toBe("respond_order");
      expect(offlineSyncQueue.getQueue()).toHaveLength(1);
      expect(offlineSyncQueue.getQueue()[0].payload.orderId).toBe("ord_123");
    });

    it("removes items and clears queue", () => {
      const item1 = offlineSyncQueue.enqueue("respond_order", { orderId: "ord_1" });
      offlineSyncQueue.enqueue("respond_order", { orderId: "ord_2" });

      expect(offlineSyncQueue.getQueue()).toHaveLength(2);

      offlineSyncQueue.removeAction(item1.id);
      expect(offlineSyncQueue.getQueue()).toHaveLength(1);

      offlineSyncQueue.clearQueue();
      expect(offlineSyncQueue.getQueue()).toHaveLength(0);
    });
  });
});
