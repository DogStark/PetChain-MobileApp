import React, {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from 'react';
import { Animated, StyleSheet, Text } from 'react-native';

import { useTheme } from './ThemeContext';

export type ToastVariant = 'info' | 'error' | 'success';

interface ToastOptions {
  variant?: ToastVariant;
  durationMs?: number;
}

interface ToastState {
  id: number;
  message: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  show: (message: string, options?: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

const DEFAULT_DURATION_MS = 3000;

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toast, setToast] = useState<ToastState | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idRef = useRef(0);

  const hide = useCallback(() => {
    Animated.timing(opacity, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => setToast(null));
  }, [opacity]);

  const show = useCallback(
    (message: string, options?: ToastOptions) => {
      const id = ++idRef.current;
      const variant = options?.variant ?? 'info';
      const durationMs = options?.durationMs ?? DEFAULT_DURATION_MS;

      if (hideTimer.current) {
        clearTimeout(hideTimer.current);
      }

      setToast({ id, message, variant });
      opacity.setValue(0);
      Animated.timing(opacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();

      hideTimer.current = setTimeout(() => {
        // Guard against a newer toast having replaced this one
        if (idRef.current === id) {
          hide();
        }
      }, durationMs);
    },
    [hide, opacity],
  );

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <ToastHost toast={toast} opacity={opacity} />
    </ToastContext.Provider>
  );
};

const ToastHost: React.FC<{
  toast: ToastState | null;
  opacity: Animated.Value;
}> = ({ toast, opacity }) => {
  const { colors } = useTheme();

  if (!toast) return null;

  const backgroundColor =
    toast.variant === 'error'
      ? colors.error
      : toast.variant === 'success'
        ? colors.success
        : colors.text;

  return (
    <Animated.View
      style={[styles.container, { opacity, backgroundColor }]}
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      testID="toast-host"
    >
      <Text style={[styles.text, { color: colors.white }]}>{toast.message}</Text>
    </Animated.View>
  );
};

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return ctx;
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 32,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 4,
    zIndex: 1000,
  },
  text: {
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
});