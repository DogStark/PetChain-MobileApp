import React from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { render, act, waitFor } from '@testing-library/react-native';

import QRScannerScreen from '../src/screens/QRScannerScreen';

// --- Fake scanner lifecycle -------------------------------------------------
// A minimal controllable scanner that lets tests drive decode results and
// observe cancellation, mirroring the real scanner's callback contract.
type ScanResult = { data: string };

class FakeScanner {
  private onResult: ((result: ScanResult) => void) | null = null;
  private onCancel: (() => void) | null = null;
  public cancelled = false;
  public started = 0;

  start(onResult: (result: ScanResult) => void, onCancel?: () => void) {
    this.started += 1;
    this.onResult = onResult;
    this.onCancel = onCancel ?? null;
  }

  cancel() {
    this.cancelled = true;
    this.onCancel?.();
  }

  // Simulate a decode result arriving asynchronously.
  emit(result: ScanResult) {
    this.onResult?.(result);
  }
}

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
  };
});

jest.mock('../src/components/QRScanner', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: React.forwardRef((props: any, ref: any) => {
      React.useImperativeHandle(ref, () => ({
        start: props.onStart,
        cancel: props.onCancel,
      }));
      return React.createElement(View, { testID: 'qr-scanner' });
    }),
  };
});

const flush = () => act(async () => { await Promise.resolve(); });

describe('QRScannerScreen app-state races', () => {
  let scanner: FakeScanner;

  beforeEach(() => {
    scanner = new FakeScanner();
    mockNavigate.mockReset();
    mockGoBack.mockReset();
  });

  it('does not navigate when a scan result arrives after unmount', async () => {
    const { unmount } = render(<QRScannerScreen scanner={scanner as any} />);

    await flush();
    unmount();

    // Late result after the screen has unmounted must be ignored.
    act(() => {
      scanner.emit({ data: 'late-result' });
    });
    await flush();

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockGoBack).not.toHaveBeenCalled();
  });

  it('cancels pending decode work on unmount', async () => {
    const { unmount } = render(<QRScannerScreen scanner={scanner as any} />);
    await flush();

    unmount();

    expect(scanner.cancelled).toBe(true);
  });

  it('cancels decode work when the app is backgrounded', async () => {
    const listeners: Array<(s: AppStateStatus) => void> = [];
    const addSpy = jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((_type: any, handler: any) => {
        listeners.push(handler);
        return { remove: jest.fn() } as any;
      });

    render(<QRScannerScreen scanner={scanner as any} />);
    await flush();

    act(() => {
      listeners.forEach((l) => l('background'));
    });
    await flush();

    expect(scanner.cancelled).toBe(true);
    addSpy.mockRestore();
  });

  it('produces exactly one result for one active scan', async () => {
    render(<QRScannerScreen scanner={scanner as any} />);
    await flush();

    act(() => {
      scanner.emit({ data: 'first' });
      scanner.emit({ data: 'first' });
      scanner.emit({ data: 'second' });
    });
    await flush();

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledTimes(1);
    });
  });

  it('ignores results from a stale navigation identity after rapid navigation', async () => {
    const first = render(<QRScannerScreen scanner={scanner as any} />);
    await flush();

    // Rapid navigation: unmount the first screen before its result resolves.
    first.unmount();

    const secondScanner = new FakeScanner();
    render(<QRScannerScreen scanner={secondScanner as any} />);
    await flush();

    act(() => {
      scanner.emit({ data: 'stale' });
    });
    await flush();

    // The stale screen must not navigate on the new stack.
    expect(mockNavigate).not.toHaveBeenCalled();

    act(() => {
      secondScanner.emit({ data: 'fresh' });
    });
    await flush();

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledTimes(1);
    });
  });
});
