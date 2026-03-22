import { P2PRateBanner } from '@/features/dashboard/components/P2PRateBanner';
import { StatsGrid } from '@/features/dashboard/components/StatsGrid';
import { RecentActivity } from '@/features/dashboard/components/RecentActivity';

export default function DashboardPage() {
  return (
    <div className="space-y-4">
      <P2PRateBanner />
      <StatsGrid />
      <RecentActivity />
    </div>
  );
}
