/**
 * AppInstallPrompt
 *
 * App-wide PWA install prompt shown to ALL mobile browser users (merchant + customer).
 * - Full-screen modal on first visit until dismissed
 * - After dismiss: compact sticky banner at top that re-appears every page load
 * - Completely hidden only when the app is actually installed (PWA/native)
 * - Supports Arabic/English via theme context
 */

import { useState, useEffect, useCallback } from 'react';
import { Download, Share, Smartphone, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useTheme } from '@/lib/theme-context';
import { isInstalledPwa, isNativeApp } from '@/platform/runtime';
import {
  detectMobileInstallContext,
  captureInstallPrompt,
  getDeferredInstallPrompt,
  consumeInstallPrompt,
} from '@/features/parent-order-fulfillment/mobileInstall';

const DISMISS_KEY = 'pwa_install_banner_dismissed';

export function AppInstallPrompt() {
  const { settings } = useTheme();
  const lang = settings.language;
  const L = (en: string, ar: string) => lang === 'ar' ? ar : en;

  const [isInstalled, setIsInstalled] = useState(() => isInstalledPwa() || isNativeApp());
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);
  const [nativePromptReady, setNativePromptReady] = useState(() => getDeferredInstallPrompt() !== null);
  const [dismissed, setDismissed] = useState(() =>
    typeof sessionStorage !== 'undefined' && sessionStorage.getItem(DISMISS_KEY) === 'true'
  );

  // Listen for beforeinstallprompt
  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      captureInstallPrompt(e as BeforeInstallPromptEvent);
      setNativePromptReady(true);
    };
    window.addEventListener('beforeinstallprompt', handler);

    // Listen for app installed
    const installedHandler = () => setIsInstalled(true);
    window.addEventListener('appinstalled', installedHandler);

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      window.removeEventListener('appinstalled', installedHandler);
    };
  }, []);

  // Re-check on resize
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const onResize = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        setIsMobile(window.innerWidth < 768);
        setIsInstalled(isInstalledPwa() || isNativeApp());
      }, 300);
    };
    window.addEventListener('resize', onResize);
    return () => { window.removeEventListener('resize', onResize); clearTimeout(timer); };
  }, []);

  const triggerInstall = useCallback(async () => {
    const prompt = getDeferredInstallPrompt();
    if (prompt) {
      const result = await prompt.prompt();
      consumeInstallPrompt();
      if (result.outcome === 'accepted') {
        setIsInstalled(true);
      }
      setNativePromptReady(false);
    }
  }, []);

  const dismiss = useCallback(() => {
    sessionStorage.setItem(DISMISS_KEY, 'true');
    setDismissed(true);
  }, []);

  // Don't show if installed or desktop
  if (isInstalled || !isMobile) return null;

  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isAndroid = /android/i.test(navigator.userAgent);

  // ── Compact banner (after first dismiss) ──
  if (dismissed) {
    return (
      <div className="sticky top-0 z-[60] flex items-center justify-between gap-2 bg-primary px-3 py-2">
        <div className="flex items-center gap-2 min-w-0">
          <Smartphone className="h-4 w-4 shrink-0 text-primary-foreground" />
          <p className="text-xs font-semibold text-primary-foreground truncate">
            {L('Install the app for a better experience', 'ثبّت التطبيق لتجربة أفضل')}
          </p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          className="shrink-0 h-7 px-3 text-[11px] font-bold"
          onClick={nativePromptReady ? triggerInstall : dismiss}
        >
          {nativePromptReady ? L('Install', 'تثبيت') : L('How?', 'كيف؟')}
        </Button>
      </div>
    );
  }

  // ── Full overlay (first time) ──
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm rounded-3xl bg-card border border-border/40 overflow-hidden">
        {/* Header */}
        <div className="relative bg-primary/10 px-6 pt-8 pb-6 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/20 text-primary mb-4">
            <Smartphone className="h-8 w-8" />
          </div>
          <h2 className="text-lg font-bold text-foreground">
            {L('Install P2P Tracker', 'ثبّت P2P Tracker')}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {L(
              'Get instant access from your home screen with push notifications and offline support.',
              'احصل على وصول فوري من شاشتك الرئيسية مع إشعارات فورية ودعم بدون إنترنت.'
            )}
          </p>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          {/* iOS instructions */}
          {isIOS && (
            <div className="rounded-xl border border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground">
              <p className="font-semibold text-foreground mb-2">
                {L('How to install on iPhone:', 'كيفية التثبيت على الآيفون:')}
              </p>
              <ol className="list-decimal space-y-1.5 ps-4">
                <li>
                  {L('Tap the', 'اضغط على زر')} <Share className="inline h-3 w-3 mx-0.5" /> {L('Share button in Safari', 'المشاركة في Safari')}
                </li>
                <li>
                  {L('Tap', 'اضغط')} <strong>{L('Add to Home Screen', 'إضافة إلى الشاشة الرئيسية')}</strong>
                </li>
              </ol>
            </div>
          )}

          {/* Android without native prompt */}
          {isAndroid && !nativePromptReady && (
            <div className="rounded-xl border border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground">
              <p className="font-semibold text-foreground mb-2">
                {L('How to install:', 'كيفية التثبيت:')}
              </p>
              <ol className="list-decimal space-y-1.5 ps-4">
                <li>{L('Open browser menu (⋮)', 'افتح قائمة المتصفح (⋮)')}</li>
                <li>
                  {L('Tap', 'اضغط')} <strong>{L('Install app', 'تثبيت التطبيق')}</strong> {L('or', 'أو')} <strong>{L('Add to Home screen', 'إضافة إلى الشاشة الرئيسية')}</strong>
                </li>
              </ol>
            </div>
          )}

          {/* Buttons */}
          <div className="flex gap-2">
            {nativePromptReady ? (
              <>
                <Button className="flex-1 gap-2 h-11" onClick={triggerInstall}>
                  <Download className="h-4 w-4" />
                  {L('Install Now', 'ثبّت الآن')}
                </Button>
                <Button variant="outline" className="h-11" onClick={dismiss}>
                  {L('Later', 'لاحقاً')}
                </Button>
              </>
            ) : (
              <Button className="flex-1 h-11" variant="outline" onClick={dismiss}>
                {L('Got it', 'فهمت')}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
