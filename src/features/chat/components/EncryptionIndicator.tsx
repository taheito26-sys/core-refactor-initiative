// ─── EncryptionIndicator — Phase 24 ─────────────────────────────────────
// Visual lock icons and encryption status for rooms

import { Lock, ShieldCheck, Shield, ShieldOff, Fingerprint } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ChatEncryptionMode } from '../types';

interface Props {
  mode: ChatEncryptionMode;
  compact?: boolean;
}

const CONFIG: Record<ChatEncryptionMode, {
  icon: React.ElementType;
  label: string;
  description: string;
  color: string;
  bg: string;
}> = {
  client_e2ee: {
    icon: Lock,
    label: 'End-to-end encrypted',
    description: 'Messages are encrypted on your device. Only participants can read them.',
    color: 'text-emerald-600 dark:text-emerald-400',
    bg: 'bg-emerald-500/10',
  },
  server_e2ee: {
    icon: ShieldCheck,
    label: 'Server encrypted',
    description: 'Messages are encrypted in transit and at rest on the server.',
    color: 'text-blue-600 dark:text-blue-400',
    bg: 'bg-blue-500/10',
  },
  tls_only: {
    icon: Shield,
    label: 'Transport encrypted',
    description: 'Messages are encrypted in transit using TLS.',
    color: 'text-muted-foreground',
    bg: 'bg-muted',
  },
  none: {
    icon: ShieldOff,
    label: 'No encryption',
    description: 'Messages are not encrypted. Use caution with sensitive data.',
    color: 'text-destructive',
    bg: 'bg-destructive/10',
  },
};

export function EncryptionIndicator({ mode, compact = false }: Props) {
  const config = CONFIG[mode];
  const Icon = config.icon;

  if (compact) {
    return (
      <span className={cn('inline-flex items-center gap-1', config.color)} title={config.label}>
        <Icon className="h-3 w-3" />
      </span>
    );
  }

  return (
    <div className={cn('flex items-start gap-2.5 px-3 py-2.5 rounded-xl', config.bg)}>
      <Icon className={cn('h-4 w-4 mt-0.5 shrink-0', config.color)} />
      <div>
        <p className={cn('text-xs font-semibold', config.color)}>{config.label}</p>
        <p className="text-[10px] text-muted-foreground/70 mt-0.5 leading-relaxed">{config.description}</p>
      </div>
    </div>
  );
}

// Phase 24: Key fingerprint verification
export function KeyFingerprint({ fingerprint, verified }: { fingerprint: string; verified?: boolean }) {
  const chunks = fingerprint.match(/.{1,4}/g) ?? [fingerprint];
  return (
    <div className="flex flex-col items-center gap-2 py-3">
      <Fingerprint className={cn('h-8 w-8', verified ? 'text-emerald-500' : 'text-muted-foreground/50')} />
      <div className="grid grid-cols-4 gap-1">
        {chunks.slice(0, 8).map((chunk, i) => (
          <span key={i} className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
            {chunk}
          </span>
        ))}
      </div>
      <p className={cn('text-[10px] font-semibold', verified ? 'text-emerald-500' : 'text-amber-500')}>
        {verified ? '✓ Verified' : '⚠ Not verified'}
      </p>
    </div>
  );
}

// Phase 24: Encryption banner for room info
export function EncryptionBanner({ mode }: { mode: ChatEncryptionMode }) {
  const config = CONFIG[mode];
  const Icon = config.icon;

  return (
    <div className="px-4 py-3 border-b border-border/50">
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/50 mb-2">Encryption</p>
      <div className={cn('flex items-center gap-2.5 px-3 py-2 rounded-lg', config.bg)}>
        <Icon className={cn('h-4 w-4', config.color)} />
        <div>
          <p className={cn('text-[11px] font-bold', config.color)}>{config.label}</p>
          <p className="text-[9px] text-muted-foreground/60 mt-0.5">{config.description}</p>
        </div>
      </div>
    </div>
  );
}
