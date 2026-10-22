import * as ScreenCapture from 'expo-screen-capture';
import { useEffect } from 'react';

/**
 * Prevents screenshots and screen recording on the current screen.
 * Call inside any screen component that displays sensitive data.
 */
export function useSecureScreen(): void {
  useEffect(() => {
    void ScreenCapture.preventScreenCaptureAsync();
    return () => {
      void ScreenCapture.allowScreenCaptureAsync();
    };
  }, []);
}
