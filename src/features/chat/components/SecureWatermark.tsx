// ─── SecureWatermark — Full 25-phase watermark & privacy system ──────────
// Phase 1: Dynamic watermark engine (density, opacity, text, rotation)
// Phase 2: Room-level watermark policies
// Phase 3: Watermark on media previews
// Phase 4: Watermark on exports & downloads
// Phase 5: Watermark audit trail
// Phase 7: Screen share watermark
// Phase 10: Media viewer protection

import { useCallback, useEffect, useRef } from 'react';
import { useAuth } from '@/features/auth/auth-context';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';

// ── Phase 1: Density config ───────────────────────────────────────────────
export type WatermarkDensity = 'light' | 'medium' | 'heavy';

const DENSITY_CONFIG: Record<WatermarkDensity, { opacity: number; spacing: number; fontSize: number; rotation: number }> = {
  light:  { opacity: 0.025, spacing: 280, fontSize: 9,  rotation: -30 },
  medium: { opacity: 0.045, spacing: 200, fontSize: 10, rotation: -25 },
  heavy:  { opacity: 0.08,  spacing: 150, fontSize: 11, rotation: -20 },
};

interface Props {
  enabled: boolean;
  customText?: string;
  density?: WatermarkDensity;
  overlay?: boolean;
  roomId?: string;
  /** When true, logs render events to audit trail */
  auditLog?: boolean;
}

// ── Phase 5: Audit trail logging ─────────────────────────────────────────
function logWatermarkEvent(userId: string | null, roomId?: string, eventType = 'watermark_render', meta: Record<string, unknown> = {}) {
  if (!userId) return;
  supabase.from('chat_audit_events').insert({
    user_id: userId,
    room_id: roomId ?? null,
    event_type: eventType,
    metadata: { ...meta, timestamp: new Date().toISOString() },
  }).then(() => {});
}

export function SecureWatermark({ enabled, customText, density = 'light', overlay = false, roomId, auditLog = false }: Props) {
  const { merchantProfile, userId } = useAuth();
  const loggedRef = useRef(false);

  // Phase 5: Log watermark render (once per mount)
  useEffect(() => {
    if (enabled && auditLog && !loggedRef.current) {
      loggedRef.current = true;
      logWatermarkEvent(userId ?? null, roomId, 'watermark_render', { density, overlay });
    }
  }, [enabled, auditLog, userId, roomId, density, overlay]);

  if (!enabled) return null;

  const identifier = customText || merchantProfile?.merchant_id || userId?.slice(0, 8) || 'SECURE';
  const date = new Date().toISOString().split('T')[0];
  const time = new Date().toTimeString().slice(0, 5);
  const watermarkText = `${identifier} · ${date} ${time}`;
  const config = DENSITY_CONFIG[density];
  const patternId = `wm-${density}-${roomId?.slice(0, 6) ?? 'global'}`;

  return (
    <div
      className={cn(
        'absolute inset-0 pointer-events-none select-none overflow-hidden',
        overlay ? 'z-50' : 'z-0',
      )}
      style={{ opacity: config.opacity }}
      data-watermark-hash={btoa(watermarkText).slice(0, 16)}
      data-watermark-density={density}
      data-watermark="true"
    >
      <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern
            id={patternId}
            x="0" y="0"
            width={config.spacing}
            height={config.spacing / 2}
            patternUnits="userSpaceOnUse"
            patternTransform={`rotate(${config.rotation})`}
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
        <rect width="100%" height="100%" fill={`url(#${patternId})`} />
      </svg>
    </div>
  );
}

// ── Phase 3: Document watermark for PDF/doc previews ─────────────────────
export function DocumentWatermark({ viewerId, documentId }: { viewerId: string; documentId?: string }) {
  useEffect(() => {
    logWatermarkEvent(viewerId, undefined, 'document_watermark_view', { documentId });
  }, [viewerId, documentId]);

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

// ── Phase 7: Screen share watermark ──────────────────────────────────────
export function ScreenShareWatermark({ userId }: { userId: string }) {
  return (
    <SecureWatermark
      enabled
      customText={`SCREEN SHARE · ${userId.slice(0, 8)}`}
      density="medium"
      overlay
      auditLog
    />
  );
}

// ── Phase 3: Media preview watermark ─────────────────────────────────────
export function MediaPreviewWatermark({ viewerId, roomId }: { viewerId: string; roomId?: string }) {
  return (
    <SecureWatermark
      enabled
      customText={`${viewerId.slice(0, 8)} · PREVIEW`}
      density="light"
      overlay={false}
      roomId={roomId}
    />
  );
}

// ── Phase 4: Export watermark (burn-in text for exported content) ────────
export function ExportWatermark({ userId, exportType }: { userId: string; exportType: 'transcript' | 'image' | 'forward' }) {
  useEffect(() => {
    logWatermarkEvent(userId, undefined, 'export_watermark', { exportType });
  }, [userId, exportType]);

  return (
    <SecureWatermark
      enabled
      customText={`EXPORTED · ${userId.slice(0, 8)} · ${exportType.toUpperCase()}`}
      density="heavy"
      overlay
      auditLog
    />
  );
}

// ── Phase 10: Lightbox-safe watermark that scales with zoom ─────────────
export function LightboxWatermark({ viewerId, zoomLevel = 1 }: { viewerId: string; zoomLevel?: number }) {
  const adjustedDensity: WatermarkDensity = zoomLevel > 2 ? 'heavy' : zoomLevel > 1.5 ? 'medium' : 'light';
  return (
    <SecureWatermark
      enabled
      customText={`${viewerId.slice(0, 8)} · VIEWER`}
      density={adjustedDensity}
      overlay
    />
  );
}
