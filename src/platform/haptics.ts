import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";
import { isNativeApp } from "@/platform/runtime";

/**
 * Unified Haptic Feedback Service
 * Provides tactile feedback for native Capacitor (iOS/Android) with fallback
 * to HTML5 Web Vibration API on supported web browsers.
 */
export class HapticService {
  private static isVibrateSupported(): boolean {
    return typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
  }

  /**
   * Impact haptic feedback (light, medium, heavy)
   */
  static async impact(style: ImpactStyle = ImpactStyle.Medium): Promise<void> {
    try {
      if (isNativeApp()) {
        await Haptics.impact({ style });
      } else if (this.isVibrateSupported()) {
        const duration = style === ImpactStyle.Heavy ? 40 : style === ImpactStyle.Medium ? 20 : 10;
        navigator.vibrate(duration);
      }
    } catch {
      // Ignore haptic failures silently
    }
  }

  /**
   * Notification haptic feedback (Success, Warning, Error)
   */
  static async notification(type: NotificationType = NotificationType.Success): Promise<void> {
    try {
      if (isNativeApp()) {
        await Haptics.notification({ type });
      } else if (this.isVibrateSupported()) {
        if (type === NotificationType.Success) {
          navigator.vibrate([15, 30, 15]);
        } else if (type === NotificationType.Warning) {
          navigator.vibrate([30, 50, 30]);
        } else if (type === NotificationType.Error) {
          navigator.vibrate([50, 40, 50, 40, 50]);
        }
      }
    } catch {
      // Ignore haptic failures silently
    }
  }

  /**
   * Selection haptic feedback for pickers, tabs, toggles
   */
  static async selection(): Promise<void> {
    try {
      if (isNativeApp()) {
        await Haptics.selectionStart();
        await Haptics.selectionChanged();
        await Haptics.selectionEnd();
      } else if (this.isVibrateSupported()) {
        navigator.vibrate(8);
      }
    } catch {
      // Ignore haptic failures silently
    }
  }

  /**
   * Quick convenience methods for standard actions
   */
  static async triggerSuccess(): Promise<void> {
    await this.notification(NotificationType.Success);
  }

  static async triggerWarning(): Promise<void> {
    await this.notification(NotificationType.Warning);
  }

  static async triggerError(): Promise<void> {
    await this.notification(NotificationType.Error);
  }

  static async triggerSelection(): Promise<void> {
    await this.selection();
  }

  static async triggerImpactLight(): Promise<void> {
    await this.impact(ImpactStyle.Light);
  }

  static async triggerImpactMedium(): Promise<void> {
    await this.impact(ImpactStyle.Medium);
  }

  static async triggerImpactHeavy(): Promise<void> {
    await this.impact(ImpactStyle.Heavy);
  }
}

export const triggerHapticSuccess = () => void HapticService.triggerSuccess();
export const triggerHapticWarning = () => void HapticService.triggerWarning();
export const triggerHapticError = () => void HapticService.triggerError();
export const triggerHapticSelection = () => void HapticService.triggerSelection();
export const triggerHapticImpactLight = () => void HapticService.triggerImpactLight();
export const triggerHapticImpactMedium = () => void HapticService.triggerImpactMedium();
export const triggerHapticImpactHeavy = () => void HapticService.triggerImpactHeavy();
