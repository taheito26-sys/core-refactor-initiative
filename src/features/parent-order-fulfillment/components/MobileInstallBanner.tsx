/**
 * MobileInstallBanner
 *
 * Displays a dismissible install prompt for mobile browser users.
 * - Android with native prompt: "Install App" button triggers BeforeInstallPromptEvent
 * - Android without native prompt / iOS: shows manual installation instructions
 * - Dismiss (X button): suppresses for the session via sessionStorage
 * - Never shown when already installed (PWA/native) or on desktop
 *
 * Requirements: 9.1–9.9, 10.1–10.7
 */

import { Download, Share, Smartphone, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { useMobileInstallPrompt } from '../hooks/useMobileInstallPrompt';

export function MobileInstallBanner() {
  const { context, shouldShow, triggerInstall, dismiss } =
    useMobileInstallPrompt();

  if (!shouldShow) return null;

  const isAndroid = context.platform === 'android';
  const isIOS = context.platform === 'ios';
  const canNativeInstall = isAndroid && context.nativePromptAvailable;

  return (
    <div
      className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-md"
      role="banner"
      aria-label="Install application"
    >
      <Card className="border-primary/20 bg-card/95 shadow-2xl backdrop-blur">
        <CardContent className="space-y-3 p-4">
          {/* Header row */}
          <div className="flex items-start gap-3">
            <div
              className={cn(
                'mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl',
                'bg-primary/10 text-primary',
              )}
            >
              <Smartphone className="h-5 w-5" />
            </div>

            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground">
                Install the app
              </p>
              <p className="text-xs text-muted-foreground">
                Add the portal to your home screen for quicker access and a
                better mobile experience.
              </p>
            </div>

            {/* Dismiss button */}
            <button
              type="button"
              onClick={dismiss}
              className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Dismiss install prompt"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* iOS instructions */}
          {isIOS && (
            <div className="rounded-xl border border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground">
              <p className="font-semibold text-foreground">
                On iPhone or iPad:
              </p>
              <ol className="mt-2 list-decimal space-y-1 ps-4">
                <li>
                  Tap the <Share className="inline h-3 w-3" /> Share button in
                  Safari.
                </li>
                <li>
                  Tap <strong>Add to Home Screen</strong>.
                </li>
              </ol>
            </div>
          )}

          {/* Android without native prompt — manual instructions */}
          {isAndroid && !canNativeInstall && (
            <div className="rounded-xl border border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground">
              <p className="font-semibold text-foreground">
                Install from your browser:
              </p>
              <ol className="mt-2 list-decimal space-y-1 ps-4">
                <li>Open the browser menu (⋮).</li>
                <li>
                  Tap <strong>Add to Home screen</strong> or{' '}
                  <strong>Install app</strong>.
                </li>
              </ol>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-2">
            {canNativeInstall ? (
              <Button className="flex-1 gap-2" onClick={triggerInstall}>
                <Download className="h-4 w-4" />
                Install App
              </Button>
            ) : (
              <Button className="flex-1" variant="outline" onClick={dismiss}>
                Got it
              </Button>
            )}

            {canNativeInstall && (
              <Button variant="outline" onClick={dismiss}>
                Not now
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
