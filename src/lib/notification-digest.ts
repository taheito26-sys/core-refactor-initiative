export function buildNotificationDigest(notifications: Array<{ category: string | null }>) {
  const categories: Record<string, number> = Object.create(null);
  for (const notification of notifications) {
    const category = notification.category || 'other';
    categories[category] = (categories[category] ?? 0) + 1;
  }
  const count = notifications.length;
  const summary = count === 0 ? "No unread notifications. You're all caught up! 🎉"
    : `You have ${count} unread notifications:\n${Object.entries(categories).map(([category, total]) => `• ${total} ${category} notification${total > 1 ? 's' : ''}`).join('\n')}`;
  return { summary, count, categories };
}
