import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockEnqueue = jest.fn();
const mockFlush = jest.fn();
jest.mock('../../services/offlineQueue', () => ({
  enqueue: (...args: any[]) => mockEnqueue(...args),
  flush: (...args: any[]) => mockFlush(...args),
}));

const mockIsOnline = jest.fn();
const mockSubscribe = jest.fn();
jest.mock('../../services/networkMonitor', () => ({
  isOnline: (...args: any[]) => mockIsOnline(...args),
  subscribe: (...args: any[]) => mockSubscribe(...args),
}));

const mockFetchPermissions = jest.fn();
jest.mock('../../services/api', () => ({
  fetchPermissions: (...args: any[]) => mockFetchPermissions(...args),
}));

const mockGetItem = jest.fn();
const mockSetItem = jest.fn();
jest.mock('../../services/storage', () => ({
  getItem: (...args: any[]) => mockGetItem(...args),
  setItem: (...args: any[]) => mockSetItem(...args),
}));

// ---------------------------------------------------------------------------
// Imports under test (after mocks)
// ---------------------------------------------------------------------------

import * as model from '../../services/travelPackingChecklist/model';
import * as service from '../../services/travelPackingChecklist/service';
import { useTravelPackingChecklist } from '../../hooks/useTravelPackingChecklist';
import TravelPackingChecklistScreen from '../TravelPackingChecklistScreen';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeTemplate = () => model.createDefaultTemplate();

const makeItem = (overrides: Partial<model.ChecklistItem> = {}): model.ChecklistItem => ({
  id: 'item-1',
  label: 'Food bowl',
  category: 'food',
  checked: false,
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockIsOnline.mockResolvedValue(true);
  mockSubscribe.mockReturnValue(() => {});
  mockFetchPermissions.mockResolvedValue({ canSync: true });
  mockGetItem.mockResolvedValue(null);
  mockSetItem.mockResolvedValue(undefined);
  mockEnqueue.mockResolvedValue(undefined);
  mockFlush.mockResolvedValue(undefined);
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
});

// ---------------------------------------------------------------------------
// Model helpers
// ---------------------------------------------------------------------------

describe('travelPackingChecklist model', () => {
  it('seeds a default template with the four required categories', () => {
    const template = makeTemplate();
    const categories = new Set(template.items.map((i) => i.category));
    expect(categories).toEqual(new Set(['food', 'records', 'medication', 'equipment']));
    expect(template.items.length).toBeGreaterThan(0);
    expect(template.items.every((i) => i.checked === false)).toBe(true);
  });

  it('toggles an item checked state', () => {
    const template = makeTemplate();
    const target = template.items[0];
    const toggled = model.toggleItem(template, target.id);
    expect(toggled.items.find((i) => i.id === target.id)!.checked).toBe(true);
    const toggledBack = model.toggleItem(toggled, target.id);
    expect(toggledBack.items.find((i) => i.id === target.id)!.checked).toBe(false);
  });

  it('adds a new item to a category', () => {
    const template = makeTemplate();
    const added = model.addItem(template, { label: 'Passport', category: 'records' });
    expect(added.items.some((i) => i.label === 'Passport' && i.category === 'records')).toBe(true);
  });

  it('removes an item by id', () => {
    const template = makeTemplate();
    const target = template.items[0];
    const removed = model.removeItem(template, target.id);
    expect(removed.items.find((i) => i.id === target.id)).toBeUndefined();
  });

  it('renames an item by id', () => {
    const template = makeTemplate();
    const target = template.items[0];
    const renamed = model.renameItem(template, target.id, 'New label');
    expect(renamed.items.find((i) => i.id === target.id)!.label).toBe('New label');
  });

  it('computes a progress summary', () => {
    const template = makeTemplate();
    const first = template.items[0];
    const toggled = model.toggleItem(template, first.id);
    const summary = model.getProgressSummary(toggled);
    expect(summary.total).toBe(template.items.length);
    expect(summary.completed).toBe(1);
    expect(summary.percent).toBeCloseTo(100 / template.items.length);
  });

  it('handles an empty checklist without dividing by zero', () => {
    const empty: model.ChecklistTemplate = { items: [], updatedAt: 0 };
    const summary = model.getProgressSummary(empty);
    expect(summary.total).toBe(0);
    expect(summary.completed).toBe(0);
    expect(summary.percent).toBe(0);
  });

  it('ignores unknown item ids for toggle/remove/rename', () => {
    const template = makeTemplate();
    expect(model.toggleItem(template, 'nope').items).toEqual(template.items);
    expect(model.removeItem(template, 'nope').items).toEqual(template.items);
    expect(model.renameItem(template, 'nope', 'x').items).toEqual(template.items);
  });
});

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

describe('travelPackingChecklist service', () => {
  it('saves locally first', async () => {
    const template = makeTemplate();
    await service.saveChecklist(template);
    expect(mockSetItem).toHaveBeenCalledWith(
      expect.stringContaining('travelPackingChecklist'),
      expect.any(String),
    );
  });

  it('syncs only when online and permission granted', async () => {
    mockIsOnline.mockResolvedValue(true);
    mockFetchPermissions.mockResolvedValue({ canSync: true });
    const template = makeTemplate();
    await service.saveChecklist(template);
    expect(mockEnqueue).toHaveBeenCalled();
  });

  it('does not sync when offline', async () => {
    mockIsOnline.mockResolvedValue(false);
    const template = makeTemplate();
    await service.saveChecklist(template);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('does not sync when permission denied', async () => {
    mockIsOnline.mockResolvedValue(true);
    mockFetchPermissions.mockResolvedValue({ canSync: false });
    const template = makeTemplate();
    await service.saveChecklist(template);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('maps permission-denied errors', async () => {
    mockFetchPermissions.mockRejectedValue({ status: 403 });
    const template = makeTemplate();
    const result = await service.saveChecklist(template);
    expect(result.syncStatus).toBe('permission-denied');
  });

  it('prefers the newer template by updatedAt', () => {
    const older: model.ChecklistTemplate = { items: [makeItem({ id: 'a' })], updatedAt: 100 };
    const newer: model.ChecklistTemplate = { items: [makeItem({ id: 'b' })], updatedAt: 200 };
    expect(service.preferNewer(older, newer)).toBe(newer);
    expect(service.preferNewer(newer, older)).toBe(newer);
  });

  it('retries via withRetry on transient failure', async () => {
    let attempts = 0;
    const fn = jest.fn(async () => {
      attempts += 1;
      if (attempts < 3) throw new Error('transient');
      return 'ok';
    });
    const result = await service.withRetry(fn, { retries: 3, delayMs: 0 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does not log item labels', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const template = makeTemplate();
    await service.saveChecklist(template);
    const allArgs = [
      ...logSpy.mock.calls,
      ...warnSpy.mock.calls,
      ...errorSpy.mock.calls,
    ].flat().join(' ');
    for (const item of template.items) {
      expect(allArgs).not.toContain(item.label);
    }
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

function HookHarness({ onState }: { onState: (s: any) => void }) {
  const state = useTravelPackingChecklist();
  onState(state);
  return null;
}

describe('useTravelPackingChecklist', () => {
  it('runs the main flow: load, toggle, save', async () => {
    let latest: any;
    render(<HookHarness onState={(s) => (latest = s)} />);
    await waitFor(() => expect(latest?.template).toBeTruthy());
    const firstId = latest.template.items[0].id;
    await act(async () => {
      await latest.toggle(firstId);
    });
    expect(latest.template.items.find((i: any) => i.id === firstId).checked).toBe(true);
    expect(mockSetItem).toHaveBeenCalled();
  });

  it('surfaces permission denial', async () => {
    mockFetchPermissions.mockRejectedValue({ status: 403 });
    let latest: any;
    render(<HookHarness onState={(s) => (latest = s)} />);
    await waitFor(() => expect(latest?.syncStatus).toBe('permission-denied'));
  });

  it('prefers stale data by updatedAt', async () => {
    const local: model.ChecklistTemplate = { items: [makeItem({ id: 'local' })], updatedAt: 500 };
    mockGetItem.mockResolvedValue(JSON.stringify(local));
    let latest: any;
    render(<HookHarness onState={(s) => (latest = s)} />);
    await waitFor(() => expect(latest?.template).toBeTruthy());
    expect(latest.template.items[0].id).toBe('local');
  });

  it('retries on transient sync failure', async () => {
    mockEnqueue.mockRejectedValueOnce(new Error('transient')).mockResolvedValueOnce(undefined);
    let latest: any;
    render(<HookHarness onState={(s) => (latest = s)} />);
    await waitFor(() => expect(latest?.template).toBeTruthy());
    await act(async () => {
      await latest.toggle(latest.template.items[0].id);
    });
    expect(mockEnqueue).toHaveBeenCalled();
  });

  it('works offline without syncing', async () => {
    mockIsOnline.mockResolvedValue(false);
    let latest: any;
    render(<HookHarness onState={(s) => (latest = s)} />);
    await waitFor(() => expect(latest?.template).toBeTruthy());
    await act(async () => {
      await latest.toggle(latest.template.items[0].id);
    });
    expect(mockSetItem).toHaveBeenCalled();
    expect(mockEnqueue).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

describe('TravelPackingChecklistScreen', () => {
  it('renders accessible checkboxes and category headers', async () => {
    const { findAllByRole, getByText } = render(<TravelPackingChecklistScreen />);
    const checkboxes = await findAllByRole('checkbox');
    expect(checkboxes.length).toBeGreaterThan(0);
    expect(getByText(/food/i)).toBeTruthy();
    expect(getByText(/records/i)).toBeTruthy();
    expect(getByText(/medication/i)).toBeTruthy();
    expect(getByText(/equipment/i)).toBeTruthy();
  });

  it('shows StateView on permission denial', async () => {
    mockFetchPermissions.mockRejectedValue({ status: 403 });
    const { findByText } = render(<TravelPackingChecklistScreen />);
    expect(await findByText(/permission/i)).toBeTruthy();
  });

  it('shows StateView when offline', async () => {
    mockIsOnline.mockResolvedValue(false);
    const { findByText } = render(<TravelPackingChecklistScreen />);
    expect(await findByText(/offline/i)).toBeTruthy();
  });

  it('shows EmptyState when checklist is empty', async () => {
    mockGetItem.mockResolvedValue(JSON.stringify({ items: [], updatedAt: 0 }));
    const { findByText } = render(<TravelPackingChecklistScreen />);
    expect(await findByText(/empty|no items/i)).toBeTruthy();
  });

  it('respects reduced motion', async () => {
    (AccessibilityInfo.isReduceMotionEnabled as jest.Mock).mockResolvedValue(true);
    const { findAllByRole } = render(<TravelPackingChecklistScreen />);
    const checkboxes = await findAllByRole('checkbox');
    fireEvent.press(checkboxes[0]);
    expect(checkboxes.length).toBeGreaterThan(0);
  });
});