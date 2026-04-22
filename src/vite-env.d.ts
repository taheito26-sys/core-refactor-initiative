/// <reference types="vite/client" />

declare const __APP_BUILD_ID__: string;

/**
 * The `beforeinstallprompt` event, fired by the browser when the PWA install
 * criteria are met. Not part of the standard lib typings.
 * @see https://developer.mozilla.org/en-US/docs/Web/API/BeforeInstallPromptEvent
 */
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  prompt(): Promise<{ outcome: 'accepted' | 'dismissed' }>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}
