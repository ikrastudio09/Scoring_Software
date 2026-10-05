// Android (Capacitor) integration. A no-op in the browser.
import { Capacitor } from '@capacitor/core';

export async function initNative() {
  if (!Capacitor.isNativePlatform()) return;
  const [{ App }, { SplashScreen }, { StatusBar, Style }] = await Promise.all([
    import('@capacitor/app'),
    import('@capacitor/splash-screen'),
    import('@capacitor/status-bar'),
  ]);

  try {
    await StatusBar.setStyle({ style: Style.Dark });
    const brand = getComputedStyle(document.documentElement).getPropertyValue('--brand').trim() || '#0f766e';
    await StatusBar.setBackgroundColor({ color: brand });
  } catch { /* status bar styling is cosmetic */ }

  // Deep links: https://<domain>/matches/<id> opens the matching screen in the app.
  App.addListener('appUrlOpen', ({ url }) => {
    try {
      const { pathname, search } = new URL(url);
      if (pathname && pathname !== window.location.pathname) {
        window.history.pushState({}, '', pathname + search);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }
    } catch { /* ignore malformed links */ }
  });

  // Android back button: navigate back, or leave the app from the home screen.
  App.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack && window.location.pathname !== '/') window.history.back();
    else App.exitApp();
  });

  // Coming back to the foreground: the socket layer reconnects and resubscribes on its own.
  setTimeout(() => SplashScreen.hide(), 300);
}
