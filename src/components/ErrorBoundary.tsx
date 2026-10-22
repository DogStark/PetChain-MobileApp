import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';

import ErrorFallback from './ErrorFallback';
import crashReporting from '../services/crashReporting';
import errorLogger from '../services/errorLogger';
import updateService from '../services/updateService';
import { encryptedAsyncStorage } from '../utils/encryptedAsyncStorage';

interface Props {
  children: React.ReactNode;
  context?: { screenName?: string; petId?: string; userId?: string };
}

interface State {
  hasError: boolean;
  error?: Error | null;
  info?: React.ErrorInfo | null;
  resetKey: number;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, info: null, resetKey: 0 };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error } as Partial<State>;
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    this.setState({ info });
    void errorLogger.logError(error, info.componentStack ?? '');
    // Report to Sentry with component stack as extra context.
    // Only non-sensitive metadata is sent; crashReporting applies the
    // existing privacy redaction rules before the event leaves the app.
    crashReporting.captureException(error, {
      componentStack: info.componentStack ?? '',
      screenName: this.props.context?.screenName,
    });
  }

  handleRetry = () => {
    // bump resetKey to force children remount
    this.setState((s) => ({ hasError: false, error: null, info: null, resetKey: s.resetKey + 1 }));
  };

  handleReport = async () => {
    if (this.state.error) {
      await errorLogger.logError(this.state.error, this.state.info?.componentStack ?? '');
      // feedback to user could be added
    }
  };

  handleClearCache = () => {
    Alert.alert(
      'Reset app data?',
      'This clears app-scoped caches and settings. Your account and pet data are not affected.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: () => {
            void this.performClearCache();
          },
        },
      ],
    );
  };

  performClearCache = async () => {
    try {
      await encryptedAsyncStorage.clear();
    } catch (e) {
      // ignore
    }
    // After clearing, offer retry by remounting
    this.handleRetry();
  };

  handleRestart = async () => {
    try {
      await updateService.applyOtaUpdate();
    } catch {
      // ignore
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <ErrorFallback
          onRetry={this.handleRetry}
          onContactSupport={this.handleReport}
          onRestart={this.handleRestart}
          onClearCache={this.handleClearCache}
        />
      );
    }

    // key ensures children remount when resetKey changes
    return <React.Fragment key={String(this.state.resetKey)}>{this.props.children}</React.Fragment>;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#fff',
  },
  title: { fontSize: 20, fontWeight: '700', marginBottom: 8, color: '#1a1a1a' },
  message: { fontSize: 14, color: '#444', textAlign: 'center', marginBottom: 20 },
  actions: { flexDirection: 'row', gap: 12 },
  btn: {
    backgroundColor: '#4CAF50',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    marginHorizontal: 8,
  },
  btnText: { color: '#fff', fontWeight: '600' },
  secondary: { backgroundColor: '#e0e0e0' },
  secondaryText: { color: '#333' },
});

export default ErrorBoundary;
