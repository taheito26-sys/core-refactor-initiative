import { differenceInMinutes } from 'date-fns';
import type { Notification } from '@/hooks/useNotifications';

export interface SmartNotification extends Notification {
  groupCount?: number;
  groupLatest?: string;
  groupIds?: string[];
}

function extractSender(title: string): string {
  const fromMatch = title.match(/from\s+(.+)$/i);
  if (fromMatch) return fromMatch[1].trim().toLowerCase();
  const sentMatch = title.match(/^(.+?)\s+sent\s+you/i);
  if (sentMatch) return sentMatch[1].trim().toLowerCase();
  return title.toLowerCase();
}

function getGroupKey(item: Notification): string {
  if (item.target.dedupeKey) return `dedupe:${item.target.dedupeKey}`;
  if (item.target.conversationId) return `chat:${item.target.conversationId}:${extractSender(item.title)}`;
  return `${item.category}:${extractSender(item.title)}`;
}

export function smartGroupNotifications(items: Notification[]): SmartNotification[] {
  if (!items.length) return [];
  const result: SmartNotification[] = [];
  let i = 0;

  while (i < items.length) {
    const current = items[i];
    const key = getGroupKey(current);
    let j = i + 1;
    while (j < items.length) {
      const next = items[j];
      const withinWindow = differenceInMinutes(new Date(current.created_at), new Date(next.created_at)) <= 30;
      if (withinWindow && getGroupKey(next) === key) j++;
      else break;
    }
    const grouped = items.slice(i, j);
    result.push({
      ...grouped[0],
      groupCount: grouped.length,
      groupLatest: grouped[0].created_at,
      groupIds: grouped.map((n) => n.id),
    });
    i = j;
  }

  return result;
}
