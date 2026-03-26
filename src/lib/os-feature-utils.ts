export interface TrustFactorInput {
  responseSpeed: number;
  completionRate: number;
  disputeRate: number;
  verificationScore: number;
}

function clampPct(value: number): number {
  if (Number.isNaN(value) || !Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 100) return 100;
  return value;
}

export function computeTrustScore(input: TrustFactorInput): { score: number; factors: Array<{ name: string; value: number }> } {
  const responseSpeed = clampPct(input.responseSpeed);
  const completionRate = clampPct(input.completionRate);
  const disputeRate = clampPct(input.disputeRate);
  const verificationScore = clampPct(input.verificationScore);

  const score = Number(((responseSpeed * 0.25) + (completionRate * 0.35) + ((100 - disputeRate) * 0.2) + (verificationScore * 0.2)).toFixed(2));

  return {
    score,
    factors: [
      { name: 'response_speed', value: Number(responseSpeed.toFixed(2)) },
      { name: 'completion_rate', value: Number(completionRate.toFixed(2)) },
      { name: 'dispute_rate', value: Number(disputeRate.toFixed(2)) },
      { name: 'verification_status', value: Number(verificationScore.toFixed(2)) },
    ],
  };
}

export interface SearchVisibilityInput {
  deletedAt?: string | null;
  expiresAt?: string | null;
  isPinned?: boolean;
  legalHold?: boolean;
  now?: Date;
}

export function isMessageVisibleInSearch(input: SearchVisibilityInput): boolean {
  if (input.deletedAt) return false;
  if (input.legalHold) return true;
  if (input.isPinned) return true;
  if (!input.expiresAt) return true;

  const now = input.now ?? new Date();
  return new Date(input.expiresAt).getTime() > now.getTime();
}

export function shouldSuppressUnreadIncrement(params: {
  appFocused: boolean;
  roomFocused: boolean;
  inTargetRoom: boolean;
}): boolean {
  return params.appFocused && params.roomFocused && params.inTargetRoom;
}
