import { cn } from '@/lib/utils';

interface PageHeaderProps {
  title: string;
  description?: string;
  children?: React.ReactNode;
  className?: string;
}

/**
 * The page's own actions. The page's name already shows in the navigation bar, so no title is drawn here; `title`
 * and `description` only name the bar for assistive technology.
 */
export function PageHeader({ title, description, children, className }: PageHeaderProps) {
  if (!children) return null;
  return (
    <div className={cn('flex items-center justify-end gap-2 border-b px-6 py-2', className)} role="toolbar" aria-label={description ? `${title}: ${description}` : title}>
      {children}
    </div>
  );
}
