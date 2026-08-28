import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';

import { initApp } from '../utils/appInit';

// Keep splash visible until we explicitly hide it
SplashScreen.preventAutoHideAsync().catch(() => {
  // Already hidden or not available — safe to ignore
});

interface SplashGuardState {
  appReady: boolean;
}

/**
 * Hook that runs critical app init and hides the splash screen once done.
 * Use in App.tsx: don't render the navigator until appReady is true.
 */
export function useSplashGuard(): SplashGuardState {
  const [appReady, setAppReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        await initApp();
      } finally {
        if (!cancelled) {
          setAppReady(true);
          await SplashScreen.hideAsync().catch(() => {});
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return { appReady };
}
