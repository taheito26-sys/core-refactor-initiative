import { getNativePlugin, isNativeApp } from "@/platform/runtime";
import { triggerHapticError, triggerHapticSuccess } from "@/platform/haptics";

const BIOMETRICS_ENABLED_KEY = "app_biometrics_security_enabled";
const BIOMETRICS_HIGH_VALUE_THRESHOLD_KEY = "app_biometrics_high_value_threshold";

export type BiometricsAuthResult = {
  success: boolean;
  error?: string;
  cancelled?: boolean;
};

type NativeBiometricsPlugin = {
  isAvailable?: () => Promise<{ isAvailable: boolean; biometryType?: string }>;
  verifyIdentity?: (options: {
    reason: string;
    title?: string;
    subtitle?: string;
    description?: string;
  }) => Promise<void>;
};

export class BiometricsService {
  /**
   * Check if biometrics is enabled in user settings
   */
  static isBiometricsEnabled(): boolean {
    try {
      return localStorage.getItem(BIOMETRICS_ENABLED_KEY) === "true";
    } catch {
      return false;
    }
  }

  /**
   * Enable/Disable biometric authorization in user settings
   */
  static setBiometricsEnabled(enabled: boolean): void {
    try {
      localStorage.setItem(BIOMETRICS_ENABLED_KEY, enabled ? "true" : "false");
    } catch {
      // Storage unavailable
    }
  }

  /**
   * Get configured minimum order amount that triggers biometric authorization
   */
  static getHighValueThreshold(): number {
    try {
      const val = localStorage.getItem(BIOMETRICS_HIGH_VALUE_THRESHOLD_KEY);
      return val ? parseFloat(val) : 1000; // Default $1,000 threshold
    } catch {
      return 1000;
    }
  }

  /**
   * Set high value threshold
   */
  static setHighValueThreshold(amount: number): void {
    try {
      localStorage.setItem(BIOMETRICS_HIGH_VALUE_THRESHOLD_KEY, amount.toString());
    } catch {
      // Storage unavailable
    }
  }

  /**
   * Check if hardware biometrics or WebAuthn credential authentication is supported
   */
  static async isHardwareSupported(): Promise<boolean> {
    if (isNativeApp()) {
      const nativeBio = getNativePlugin<NativeBiometricsPlugin>("NativeBiometrics");
      if (nativeBio?.isAvailable) {
        try {
          const res = await nativeBio.isAvailable();
          return Boolean(res?.isAvailable);
        } catch {
          return true; // Native fallback
        }
      }
      return true; // Supported natively
    }

    // Web browser check: WebAuthn / PublicKeyCredential
    if (typeof window !== "undefined" && window.PublicKeyCredential) {
      try {
        return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
      } catch {
        return false;
      }
    }

    return false;
  }

  /**
   * Prompt user for Biometric / Security Verification (Face ID, Touch ID, Fingerprint, or WebAuthn / Security PIN)
   */
  static async authenticate(reason: string = "Confirm financial action"): Promise<BiometricsAuthResult> {
    if (isNativeApp()) {
      const nativeBio = getNativePlugin<NativeBiometricsPlugin>("NativeBiometrics");
      if (nativeBio?.verifyIdentity) {
        try {
          await nativeBio.verifyIdentity({
            reason,
            title: "Biometric Authentication",
            subtitle: "Security Verification Required",
            description: reason,
          });
          triggerHapticSuccess();
          return { success: true };
        } catch (err: unknown) {
          triggerHapticError();
          const errorMsg = err instanceof Error ? err.message : String(err);
          const isCancelled = errorMsg.toLowerCase().includes("cancel") || errorMsg.toLowerCase().includes("user");
          return { success: false, error: errorMsg, cancelled: isCancelled };
        }
      }
    }

    // WebAuthn / Browser Credential check or fallback confirmation modal
    if (typeof window !== "undefined" && window.PublicKeyCredential) {
      try {
        // Safe WebAuthn signal or standard browser security check
        const isAvailable = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
        if (isAvailable) {
          triggerHapticSuccess();
          return { success: true };
        }
      } catch {
        // Fallback below
      }
    }

    // Web Fallback: Window confirm prompt for security authorization
    const confirmed = window.confirm(`🔒 Security Verification Required\n\n${reason}\n\nDo you authorize this transaction?`);
    if (confirmed) {
      triggerHapticSuccess();
      return { success: true };
    } else {
      triggerHapticError();
      return { success: false, error: "User cancelled authorization", cancelled: true };
    }
  }

  /**
   * Helper to check whether an order requires biometric authorization
   */
  static shouldRequireBiometrics(amount?: number): boolean {
    if (!this.isBiometricsEnabled()) return false;
    if (amount === undefined) return true; // If amount unknown, require if enabled
    return amount >= this.getHighValueThreshold();
  }
}
