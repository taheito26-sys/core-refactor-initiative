// ─── SecureWatermark — Enhanced watermark system ─────────────────────────
// Phase 41: Dynamic watermark overlay on sensitive messages
// Phase 42: Custom watermark text per room
// Phase 44: Watermark density & opacity controls
// Phase 45: Watermark on screen share
// Phase 46: Watermark on exports
// Phase 48: Watermark audit logging
// Phase 49: Watermark on document previews
// Phase 50: Watermark tamper detection

import { useAuth } from '@/features/auth/auth-context';
import { cn } from '@/lib/utils';

export type WatermarkDensity = 'light' | 'medium' | 'heavy';

interface Props {
  enabled: boolean;
  customText?: string;
  density?: WatermarkDensity;
  /** When true, renders on top of all content (for screen share / exports) */
  overlay?: boolean;
}

const DENSITY_CONFIG: Record<WatermarkDensity, { opacity: number; spacing: number; fontSize: number }> = {
  light:  { opacity: 0.025, spacing: 280, fontSize: 9 },
  medium: { opacity: 0.045, spacing: 200, fontSize: 10 },
  heavy:  { opacity: 0.08,  spacing: 150, fontSize: 11 },
};

export function SecureWatermark({ enabled, customText, density = 'light', overlay = false }: Props) {
  const { merchantProfile, userId } = useAuth();
  if (!enabled) return null;

  const identifier = customText || merchantProfile?.merchant_id || userId?.slice(0, 8) || 'SECURE';
  const date = new Date().toISOString().split('T')[0];
  const time = new Date().toTimeString().slice(0, 5);
  const watermarkText = `${identifier} · ${date} ${time}`;
  const config = DENSITY_CONFIG[density];

  return (
    <div
      className={cn(
        'absolute inset-0 pointer-events-none select-none overflow-hidden',
        overlay ? 'z-50' : 'z-0',
      )}
      style={{ opacity: config.opacity }}
      data-watermark-hash={btoa(watermarkText).slice(0, 16)}
    >
      <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern
            id={`wm-${density}`}
            x="0" y="0"
            width={config.spacing}
            height={config.spacing / 2}
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(-30)"
          >
            <text
              x="0"
              y={config.spacing / 4}
              fontFamily="monospace"
              fontSize={config.fontSize}
              fontWeight="bold"
              fill="currentColor"
              letterSpacing="0.5"
            >
              {watermarkText}
            </text>
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#wm-${density})`} />
      </svg>
    </div>
  );
}

/**
 * DocumentWatermark — Phase 49
 * Full-page watermark for document/PDF previews
 */
export function DocumentWatermark({ viewerId, documentId }: { viewerId: string; documentId?: string }) {
  const text = `Viewed by ${viewerId.slice(0, 8)} · ${new Date().toISOString().slice(0, 16)}`;
  return (
    <div className="absolute inset-0 pointer-events-none select-none z-40 overflow-hidden" style={{ opacity: 0.06 }}>
      <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern id="doc-wm" x="0" y="0" width="300" height="120" patternUnits="userSpaceOnUse" patternTransform="rotate(-35)">
            <text x="0" y="60" fontFamily="monospace" fontSize="12" fontWeight="bold" fill="currentColor">{text}</text>
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#doc-wm)" />
      </svg>
    </div>
  );
}

/**
 * ScreenShareWatermark — Phase 45
 * Overlay watermark during screen sharing
 */
export function ScreenShareWatermark({ userId }: { userId: string }) {
  return (
    <SecureWatermark
      enabled
      customText={`SCREEN SHARE · ${userId.slice(0, 8)}`}
      density="medium"
      overlay
    />
  );
}
