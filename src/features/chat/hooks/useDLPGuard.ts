// ─── useDLPGuard — Phases 16-20: Data Loss Prevention ───────────────────
import { useState, useCallback } from 'react';
import {
  detectSensitiveData,
  validateFileUpload,
  logPrivacyEvent,
  type SensitiveDataResult,
  type FileValidationResult,
} from '../lib/privacy-engine';

interface UseDLPGuardOptions {
  userId: string;
  roomId?: string;
  roomPolicy?: {
    allowed_mime_types?: string[] | null;
    max_file_size_mb?: number;
  } | null;
}

export function useDLPGuard({ userId, roomId, roomPolicy }: UseDLPGuardOptions) {
  const [dlpWarning, setDlpWarning] = useState<SensitiveDataResult | null>(null);
  const [dlpDismissed, setDlpDismissed] = useState(false);

  // Phase 17: Check message content for sensitive data before send
  const checkMessage = useCallback((content: string): SensitiveDataResult => {
    const result = detectSensitiveData(content);
    if (result.hasSensitiveData) {
      setDlpWarning(result);
      setDlpDismissed(false);
      logPrivacyEvent(userId, roomId, 'dlp_detection', {
        types: result.detections.map((d) => d.type),
        count: result.detections.length,
      });
    } else {
      setDlpWarning(null);
    }
    return result;
  }, [userId, roomId]);

  // Phase 16: Validate file upload
  const checkFile = useCallback((file: File): FileValidationResult => {
    const result = validateFileUpload(file, roomPolicy ?? undefined);
    if (!result.ok) {
      logPrivacyEvent(userId, roomId, 'file_blocked', {
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size,
        reason: result.error,
      });
    }
    return result;
  }, [userId, roomId, roomPolicy]);

  // Dismiss DLP warning and allow send
  const dismissDlpWarning = useCallback(() => {
    setDlpDismissed(true);
    setDlpWarning(null);
    logPrivacyEvent(userId, roomId, 'dlp_override', { action: 'dismissed_by_user' });
  }, [userId, roomId]);

  return {
    dlpWarning,
    dlpDismissed,
    checkMessage,
    checkFile,
    dismissDlpWarning,
    clearDlpWarning: () => setDlpWarning(null),
  };
}
