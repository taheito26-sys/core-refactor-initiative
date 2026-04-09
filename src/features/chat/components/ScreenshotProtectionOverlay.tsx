// ─── ScreenshotProtectionOverlay — Phases 6, 8, 9 ──────────────────────
// Visual overlays for screenshot detection, blur-on-focus-loss, confidential flash

import { cn } from '@/lib/utils';
import { ShieldAlert, Camera, EyeOff } from 'lucide-react';

interface Props {
  /** Phase 6: Screenshot was detected */
  screenshotDetected?: boolean;
  screenshotNotice?: string | null;
  /** Phase 9: Content blurred because window lost focus */
  isBlurred?: boolean;
  /** Phase 9: "CONFIDENTIAL" flash overlay for protected rooms */
  confidentialFlash?: boolean;
}

export function ScreenshotProtectionOverlay({ screenshotDetected, screenshotNotice, isBlurred, confidentialFlash }: Props) {
  return (
    <>
      {/* Phase 6: Screenshot detection alert */}
      {screenshotDetected && (
        <div className="absolute inset-0 z-[60] flex items-center justify-center pointer-events-none animate-in fade-in-0 duration-150">
          <div className="bg-destructive/90 text-destructive-foreground rounded-2xl px-6 py-4 flex items-center gap-3 shadow-2xl backdrop-blur-md pointer-events-auto">
            <Camera className="h-6 w-6 animate-pulse" />
            <div>
              <p className="text-sm font-bold">Screenshot Detected</p>
              <p className="text-xs opacity-80">
                {screenshotNotice ? `Source: ${screenshotNotice}` : 'This action has been logged'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Phase 9: Blur overlay when window loses focus */}
      {isBlurred && (
        <div className="absolute inset-0 z-[55] backdrop-blur-xl bg-background/60 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <EyeOff className="h-10 w-10 opacity-40" />
            <p className="text-sm font-semibold">Content hidden for privacy</p>
            <p className="text-xs opacity-60">Return to this window to view</p>
          </div>
        </div>
      )}

      {/* Phase 9: Confidential flash */}
      {confidentialFlash && (
        <div className="absolute inset-0 z-[58] flex items-center justify-center pointer-events-none">
          <div className="flex items-center gap-2 px-4 py-2 bg-destructive/10 border border-destructive/20 rounded-lg animate-pulse">
            <ShieldAlert className="h-4 w-4 text-destructive/60" />
            <span className="text-xs font-bold text-destructive/60 tracking-wider uppercase">Confidential</span>
          </div>
        </div>
      )}
    </>
  );
}
