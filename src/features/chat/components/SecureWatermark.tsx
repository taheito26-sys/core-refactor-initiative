import { useAuth } from '@/features/auth/auth-context';

interface Props {
  enabled: boolean;
}

/**
 * SecureWatermark
 * Renders a non-intrusive but persistent SVG pattern across the chat timeline.
 * Displays the current user's ID and timestamp to deter unauthorized screenshots.
 */
export function SecureWatermark({ enabled }: Props) {
  const { merchantProfile, userId } = useAuth();
  if (!enabled) return null;

  const identifier = merchantProfile?.merchant_id || userId?.slice(0, 8) || 'SECURE';
  const date = new Date().toISOString().split('T')[0];

  return (
    <div className="absolute inset-0 pointer-events-none z-0 opacity-[0.03] select-none overflow-hidden">
      <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern id="watermark-pattern" x="0" y="0" width="200" height="100" patternUnits="userSpaceOnUse" patternTransform="rotate(-25)">
            <text 
              x="0" 
              y="50" 
              fontFamily="monospace" 
              fontSize="10" 
              fontWeight="bold" 
              fill="currentColor"
            >
              {identifier} • {date}
            </text>
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#watermark-pattern)" />
      </svg>
    </div>
  );
}