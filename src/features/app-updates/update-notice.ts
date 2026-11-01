import { createElement } from 'react';
import { toast } from 'sonner';
import { UpdateCard } from './UpdateCard';

export function showAppUpdate(phase: 'updating' | 'saving' | 'failed' = 'updating', error?: string) {
  toast.custom(() => createElement(UpdateCard, { phase, error }), { id: 'app-update', duration: Infinity, dismissible: false });
}

export function showAppUpdated() {
  toast.custom(() => createElement(UpdateCard, { phase: 'complete' }), { id: 'app-update', duration: 5000 });
}

export function dismissAppUpdate() {
  toast.dismiss('app-update');
}
