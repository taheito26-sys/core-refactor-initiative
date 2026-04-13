// ─── SecureWatermark — Full 25-phase watermark & privacy system ──────────
// Phase 1: Dynamic watermark engine (density, opacity, text, rotation)
// Phase 2: Room-level watermark policies
// Phase 3: Watermark on media previews
// Phase 4: Watermark on exports & downloads
// Phase 5: Watermark audit trail
// Phase 7: Screen share watermark
// Phase 10: Media viewer protection

import { useEffect, useId, useMemo, useRef } from 'react';
import { useAuth } from '@/features/auth/auth-context';
import { useTheme } from '@/lib/theme-context';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';

// ── Phase 1: Density config ───────────────────────────────────────────────
export type WatermarkDensity = 'light' | 'medium' | 'heavy';
export type WatermarkSurface = 'background' | 'incoming-bubble' | 'outgoing-bubble' | 'media';

const DENSITY_CONFIG: Record<WatermarkDensity, { opacity: number; spacing: number; fontSize: number; rotation: number }> = {
  light:  { opacity: 0.1, spacing: 280, fontSize: 9,  rotation: -30 },
  medium: { opacity: 0.14, spacing: 200, fontSize: 10, rotation: -25 },
  heavy:  { opacity: 0.18, spacing: 150, fontSize: 11, rotation: -20 },
};

interface Props {
  enabled: boolean;
  customText?: string;
  density?: WatermarkDensity;
  overlay?: boolean;
  roomId?: string;
  surface?: WatermarkSurface;
  showStamp?: boolean;
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

function hashText(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36).slice(0, 16);
}

function parseHslTriplet(raw: string): [number, number, number] | null {
  const parts = raw.match(/-?\d+(?:\.\d+)?/g);
  if (!parts || parts.length < 3) return null;

  const triplet = parts.slice(0, 3).map(Number);
  if (triplet.some((value) => Number.isNaN(value))) return null;

  return triplet as [number, number, number];
}

function getSurfaceVariable(surface: WatermarkSurface): string {
  switch (surface) {
    case 'incoming-bubble':
      return '--card';
    case 'outgoing-bubble':
      return '--wa-out-bubble';
    case 'media':
      return '--background';
    case 'background':
    default:
      return '--background';
  }
}

function getContrastFill(surface: WatermarkSurface): string {
  if (typeof window === 'undefined') return 'hsl(var(--foreground))';
  if (surface === 'media') return 'hsl(0 0% 100%)';

  // Use the foreground color directly — it's already the opposite of the background
  const styles = window.getComputedStyle(document.documentElement);
  const fgValue = styles.getPropertyValue('--foreground').trim();
  if (fgValue) return `hsl(${fgValue})`;

  // Fallback: detect from surface variable
  const surfaceValue = styles.getPropertyValue(getSurfaceVariable(surface)).trim();
  const parsed = parseHslTriplet(surfaceValue);

  if (!parsed) return 'hsl(var(--foreground))';

  const [, saturation, lightness] = parsed;
  const adjustedLightness = lightness + saturation * 0.04;

  return adjustedLightness >= 50 ? 'hsl(0 0% 8%)' : 'hsl(0 0% 96%)';
}

export function SecureWatermark({
  enabled,
  customText,
  density = 'light',
  overlay = false,
  roomId,
  surface = 'background',
  showStamp = surface !== 'background',
  auditLog = false,
}: Props) {
  const { merchantProfile, userId } = useAuth();
  const { settings } = useTheme();
  const loggedRef = useRef(false);
  const instanceId = useId().replace(/[:]/g, '');

  // Phase 5: Log watermark render (once per mount)
  useEffect(() => {
    if (enabled && auditLog && !loggedRef.current) {
      loggedRef.current = true;
      logWatermarkEvent(userId ?? null, roomId, 'watermark_render', { density, overlay, surface });
    }
  }, [enabled, auditLog, userId, roomId, density, overlay, surface]);

  const identifier = customText || merchantProfile?.merchant_id || userId?.slice(0, 8) || 'SECURE';
  const date = new Date().toISOString().split('T')[0];
  const time = new Date().toTimeString().slice(0, 5);
  const watermarkText = `${identifier} · ${date} ${time}`;

  const fill = useMemo(
    () => getContrastFill(surface),
    [surface, settings.layout, settings.theme],
  );

  if (!enabled) return null;

  const config = DENSITY_CONFIG[density];
  const patternId = `wm-${density}-${roomId?.slice(0, 6) ?? 'global'}-${instanceId}`;
  const opacity = surface === 'media' ? Math.min(config.opacity * 1.2, 0.22) : config.opacity;

  return (
    <div
      className={cn(
        'absolute inset-0 pointer-events-none select-none overflow-hidden',
        'z-[1]',
      )}
      style={{
        opacity,
        mixBlendMode: surface === 'media' ? 'difference' : 'normal',
      }}
      data-watermark-hash={hashText(watermarkText)}
      data-watermark-density={density}
      data-watermark-surface={surface}
      data-watermark="true"
      aria-hidden="true"
    >
      <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern
            id={patternId}
            x="0"
            y="0"
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
              fill={fill}
              letterSpacing="0.5"
            >
              {watermarkText}
            </text>
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${patternId})`} />
      </svg>
      {showStamp && (
        <div
          className="absolute bottom-1.5 right-1.5 rounded-md px-1.5 py-0.5 text-[9px] font-semibold tracking-wide shadow-sm"
          style={{
            color: fill,
            backgroundColor: surface === 'media' ? 'rgba(0, 0, 0, 0.28)' : 'rgba(0, 0, 0, 0.14)',
            opacity: Math.min(opacity + 0.28, 0.62),
            mixBlendMode: 'normal',
          }}
        >
          {identifier}
        </div>
      )}
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
            <text x="0" y="60" fontFamily="monospace" fontSize="12" fontWeight="bold" fill="hsl(var(--foreground))">{text}</text>
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
      surface="media"
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
      overlay
      surface="media"
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
      surface="media"
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
      surface="media"
    />
  );
}
