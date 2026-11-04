import { useEffect, useState } from 'react';

// Chrome/Edge/Android offer installation through a `beforeinstallprompt` event, which can fire
// before React renders, so it's captured as soon as this module loads.
type PromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
let deferred: PromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as PromptEvent; notify(); });
  window.addEventListener('appinstalled', () => { deferred = null; notify(); });
}

const standalone = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** How this browser can install the app: a one-click prompt, iOS's Share menu, or not at all. */
export function useInstall() {
  const [, force] = useState(0);
  useEffect(() => { const l = () => force((n) => n + 1); listeners.add(l); return () => { listeners.delete(l); }; }, []);
  if (standalone()) return { mode: 'installed' as const };
  if (deferred) return { mode: 'prompt' as const, install: async () => { const d = deferred!; deferred = null; notify(); await d.prompt(); } };
  if (isIos() && window.isSecureContext) return { mode: 'ios' as const };
  return { mode: 'none' as const };
}
