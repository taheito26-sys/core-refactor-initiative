import { Bell } from 'lucide-react';
import { Link } from 'react-router-dom';

/**
 * ActivityCenter — notification bell icon for the topbar.
 * Will be enhanced with real notification counts in a later phase.
 */
export default function ActivityCenter() {
  return (
    <Link
      to="/notifications"
      className="relative p-2 rounded-lg hover:bg-muted text-muted-foreground transition-colors"
    >
      <Bell className="h-5 w-5" />
    </Link>
  );
}
