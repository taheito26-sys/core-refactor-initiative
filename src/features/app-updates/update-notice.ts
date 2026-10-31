import { createElement } from 'react';
import { toast } from 'sonner';
import { UpdateCard } from './UpdateCard';

export function showAppUpdate(options: { updating: boolean; onUpdate: () => void; onLater: () => void }) {
  toast.custom(() => createElement(UpdateCard, options), { id: 'app-update', duration: Infinity, dismissible: false });
}

export function dismissAppUpdate() {
  toast.dismiss('app-update');
}
