// Re-export from features for convenience
export { AuthProvider, useAuth } from '@/features/auth/auth-context';
export type { Profile, MerchantProfile } from '@/features/auth/auth-context';
export { AuthGuard } from '@/features/auth/guards/AuthGuard';
export { ProfileGuard } from '@/features/auth/guards/ProfileGuard';
