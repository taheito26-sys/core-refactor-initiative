/**
 * Placeholder page component factory.
 * Used for pages that will be fully built in later phases.
 */
export function createPlaceholderPage(title: string, description: string) {
  return function PlaceholderPage() {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-xl font-bold text-foreground font-display">{title}</h2>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <p className="text-muted-foreground">This page will be implemented in a future phase.</p>
        </div>
      </div>
    );
  };
}
