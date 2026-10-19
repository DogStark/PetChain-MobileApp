import { render, renderHook, act, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Text } from 'react-native';

import {
  classifyRoutineDay,
  computeStreak,
  buildMonthGrid,
  getMonthBoundaries,
  RoutineDayStatus,
} from '../routineStreak';
import {
  useRoutineStreakCalendar,
  RoutineStreakCalendarState,
} from '../../hooks/useRoutineStreakCalendar';
import { RoutineStreakCalendar } from '../../components/RoutineStreakCalendar';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('../../services/routineStreakService', () => ({
  fetchRoutineEvents: jest.fn(),
}));

jest.mock('../../utils/withRetry', () => ({
  withRetry: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { fetchRoutineEvents } = require('../../services/routineStreakService');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { withRetry } = require('../../utils/withRetry');

const mockFetchRoutineEvents = fetchRoutineEvents as jest.Mock;
const mockWithRetry = withRetry as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  // Default: withRetry simply invokes the operation once.
  mockWithRetry.mockImplementation(async (op: () => Promise<unknown>) => op());
});

// ---------------------------------------------------------------------------
// classifyRoutineDay
// ---------------------------------------------------------------------------

describe('classifyRoutineDay', () => {
  it('returns "completed" when a completed event exists', () => {
    const status = classifyRoutineDay({
      date: '2024-03-10',
      events: [{ id: 'e1', date: '2024-03-10', status: 'completed' }],
    });
    expect(status).toBe<RoutineDayStatus>('completed');
  });

  it('returns "skipped" when only a skipped event exists', () => {
    const status = classifyRoutineDay({
      date: '2024-03-11',
      events: [{ id: 'e2', date: '2024-03-11', status: 'skipped' }],
    });
    expect(status).toBe<RoutineDayStatus>('skipped');
  });

  it('returns "unknown" (never "skipped") when there is no data for the day', () => {
    const status = classifyRoutineDay({ date: '2024-03-12', events: [] });
    expect(status).toBe<RoutineDayStatus>('unknown');
    expect(status).not.toBe('skipped');
  });

  it('returns "unknown" when events exist for other dates only', () => {
    const status = classifyRoutineDay({
      date: '2024-03-13',
      events: [{ id: 'e3', date: '2024-03-14', status: 'completed' }],
    });
    expect(status).toBe<RoutineDayStatus>('unknown');
  });

  it('prefers "completed" over "skipped" when both exist on the same day', () => {
    const status = classifyRoutineDay({
      date: '2024-03-15',
      events: [
        { id: 'e4', date: '2024-03-15', status: 'skipped' },
        { id: 'e5', date: '2024-03-15', status: 'completed' },
      ],
    });
    expect(status).toBe<RoutineDayStatus>('completed');
  });

  it('treats missing events array as unknown', () => {
    const status = classifyRoutineDay({ date: '2024-03-16' } as any);
    expect(status).toBe<RoutineDayStatus>('unknown');
  });
});

// ---------------------------------------------------------------------------
// computeStreak
// ---------------------------------------------------------------------------

describe('computeStreak', () => {
  it('counts consecutive completed days', () => {
    const streak = computeStreak([
      { date: '2024-03-10', status: 'completed' },
      { date: '2024-03-11', status: 'completed' },
      { date: '2024-03-12', status: 'completed' },
    ]);
    expect(streak).toBe(3);
  });

  it('treats unknown days as neutral (does not break the streak)', () => {
    const streak = computeStreak([
      { date: '2024-03-10', status: 'completed' },
      { date: '2024-03-11', status: 'unknown' },
      { date: '2024-03-12', status: 'completed' },
    ]);
    expect(streak).toBe(2);
  });

  it('breaks the streak on a skipped day', () => {
    const streak = computeStreak([
      { date: '2024-03-10', status: 'completed' },
      { date: '2024-03-11', status: 'skipped' },
      { date: '2024-03-12', status: 'completed' },
    ]);
    expect(streak).toBe(1);
  });

  it('returns 0 when there are no completed days', () => {
    const streak = computeStreak([
      { date: '2024-03-10', status: 'unknown' },
      { date: '2024-03-11', status: 'skipped' },
    ]);
    expect(streak).toBe(0);
  });

  it('returns 0 for an empty list', () => {
    expect(computeStreak([])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Month grid helpers
// ---------------------------------------------------------------------------

describe('buildMonthGrid', () => {
  it('builds a grid for a month with the correct number of days', () => {
    const grid = buildMonthGrid(2024, 2); // March 2024 (0-indexed month)
    const days = grid.flat().filter((cell) => cell !== null);
    expect(days).toHaveLength(31);
  });

  it('handles February in a leap year', () => {
    const grid = buildMonthGrid(2024, 1); // Feb 2024
    const days = grid.flat().filter((cell) => cell !== null);
    expect(days).toHaveLength(29);
  });

  it('handles February in a non-leap year', () => {
    const grid = buildMonthGrid(2023, 1); // Feb 2023
    const days = grid.flat().filter((cell) => cell !== null);
    expect(days).toHaveLength(28);
  });

  it('pads leading empty cells so the first day aligns to its weekday', () => {
    // March 1, 2024 is a Friday (weekday index 5, Sunday = 0)
    const grid = buildMonthGrid(2024, 2);
    const firstRow = grid[0];
    expect(firstRow.slice(0, 5).every((c) => c === null)).toBe(true);
    expect(firstRow[5]).not.toBeNull();
  });

  it('returns an empty grid for an invalid month', () => {
    const grid = buildMonthGrid(2024, 12);
    expect(grid.flat().filter((c) => c !== null)).toHaveLength(0);
  });
});

describe('getMonthBoundaries', () => {
  it('returns first and last day of the month', () => {
    const { start, end } = getMonthBoundaries(2024, 2); // March 2024
    expect(start).toBe('2024-03-01');
    expect(end).toBe('2024-03-31');
  });

  it('handles month boundaries across a year transition', () => {
    const { start, end } = getMonthBoundaries(2024, 0); // Jan 2024
    expect(start).toBe('2024-01-01');
    expect(end).toBe('2024-01-31');
  });

  it('handles December correctly', () => {
    const { start, end } = getMonthBoundaries(2023, 11); // Dec 2023
    expect(start).toBe('2023-12-01');
    expect(end).toBe('2023-12-31');
  });
});

// ---------------------------------------------------------------------------
// useRoutineStreakCalendar hook
// ---------------------------------------------------------------------------

describe('useRoutineStreakCalendar', () => {
  const baseEvents = [
    { id: 'e1', date: '2024-03-01', status: 'completed' },
    { id: 'e2', date: '2024-03-02', status: 'skipped' },
    { id: 'e3', date: '2024-03-03', status: 'completed' },
  ];

  it('loads events for the current month (main flow)', async () => {
    mockFetchRoutineEvents.mockResolvedValueOnce({ events: baseEvents });

    const { result } = renderHook(() =>
      useRoutineStreakCalendar({ petId: 'pet-1', initialYear: 2024, initialMonth: 2 }),
    );

    await waitFor(() => {
      expect(result.current.state).toBe<RoutineStreakCalendarState>('ready');
    });

    expect(mockFetchRoutineEvents).toHaveBeenCalledWith(
      expect.objectContaining({ petId: 'pet-1', start: '2024-03-01', end: '2024-03-31' }),
    );
    expect(result.current.days).toHaveLength(31);
    expect(result.current.days[0].status).toBe('completed');
    expect(result.current.days[1].status).toBe('skipped');
    expect(result.current.days[2].status).toBe('completed');
    expect(result.current.days[3].status).toBe('unknown');
  });

  it('maps 401 to permission-denied (not empty)', async () => {
    mockFetchRoutineEvents.mockRejectedValueOnce({ status: 401 });

    const { result } = renderHook(() =>
      useRoutineStreakCalendar({ petId: 'pet-1', initialYear: 2024, initialMonth: 2 }),
    );

    await waitFor(() => {
      expect(result.current.state).toBe<RoutineStreakCalendarState>('permission-denied');
    });
    expect(result.current.state).not.toBe('empty');
    expect(result.current.days).toHaveLength(0);
  });

  it('maps 403 to permission-denied (not empty)', async () => {
    mockFetchRoutineEvents.mockRejectedValueOnce({ status: 403 });

    const { result } = renderHook(() =>
      useRoutineStreakCalendar({ petId: 'pet-1', initialYear: 2024, initialMonth: 2 }),
    );

    await waitFor(() => {
      expect(result.current.state).toBe<RoutineStreakCalendarState>('permission-denied');
    });
    expect(result.current.state).not.toBe('empty');
  });

  it('uses cached data and flags staleness when offline', async () => {
    mockFetchRoutineEvents.mockRejectedValueOnce({ status: 0, offline: true });

    const { result } = renderHook(() =>
      useRoutineStreakCalendar({
        petId: 'pet-1',
        initialYear: 2024,
        initialMonth: 2,
        getCachedEvents: () => baseEvents,
      }),
    );

    await waitFor(() => {
      expect(result.current.state).toBe<RoutineStreakCalendarState>('stale');
    });
    expect(result.current.isStale).toBe(true);
    expect(result.current.days[0].status).toBe('completed');
  });

  it('retries via withRetry on transient failure', async () => {
    mockFetchRoutineEvents
      .mockRejectedValueOnce({ status: 500 })
      .mockResolvedValueOnce({ events: baseEvents });

    const { result } = renderHook(() =>
      useRoutineStreakCalendar({ petId: 'pet-1', initialYear: 2024, initialMonth: 2 }),
    );

    await waitFor(() => {
      expect(result.current.state).toBe<RoutineStreakCalendarState>('ready');
    });
    expect(mockWithRetry).toHaveBeenCalled();
  });

  it('exposes a retry function that re-fetches after error', async () => {
    mockFetchRoutineEvents
      .mockRejectedValueOnce({ status: 500 })
      .mockResolvedValueOnce({ events: baseEvents });

    const { result } = renderHook(() =>
      useRoutineStreakCalendar({ petId: 'pet-1', initialYear: 2024, initialMonth: 2 }),
    );

    await waitFor(() => {
      expect(result.current.state).toBe<RoutineStreakCalendarState>('error');
    });

    await act(async () => {
      await result.current.retry();
    });

    await waitFor(() => {
      expect(result.current.state).toBe<RoutineStreakCalendarState>('ready');
    });
  });

  it('reports empty state for a month with no events', async () => {
    mockFetchRoutineEvents.mockResolvedValueOnce({ events: [] });

    const { result } = renderHook(() =>
      useRoutineStreakCalendar({ petId: 'pet-1', initialYear: 2024, initialMonth: 2 }),
    );

    await waitFor(() => {
      expect(result.current.state).toBe<RoutineStreakCalendarState>('empty');
    });
    expect(result.current.days.every((d) => d.status === 'unknown')).toBe(true);
  });

  it('navigates to the previous month and refetches', async () => {
    mockFetchRoutineEvents.mockResolvedValue({ events: [] });

    const { result } = renderHook(() =>
      useRoutineStreakCalendar({ petId: 'pet-1', initialYear: 2024, initialMonth: 2 }),
    );

    await waitFor(() => {
      expect(result.current.state).toBe<RoutineStreakCalendarState>('empty');
    });

    await act(async () => {
      result.current.goToPreviousMonth();
    });

    await waitFor(() => {
      expect(mockFetchRoutineEvents).toHaveBeenLastCalledWith(
        expect.objectContaining({ start: '2024-02-01', end: '2024-02-29' }),
      );
    });
  });

  it('navigates to the next month across a year boundary', async () => {
    mockFetchRoutineEvents.mockResolvedValue({ events: [] });

    const { result } = renderHook(() =>
      useRoutineStreakCalendar({ petId: 'pet-1', initialYear: 2023, initialMonth: 11 }),
    );

    await waitFor(() => {
      expect(result.current.state).toBe<RoutineStreakCalendarState>('empty');
    });

    await act(async () => {
      result.current.goToNextMonth();
    });

    await waitFor(() => {
      expect(mockFetchRoutineEvents).toHaveBeenLastCalledWith(
        expect.objectContaining({ start: '2024-01-01', end: '2024-01-31' }),
      );
    });
  });
});

// ---------------------------------------------------------------------------
// RoutineStreakCalendar component
// ---------------------------------------------------------------------------

describe('RoutineStreakCalendar', () => {
  const days = [
    { date: '2024-03-01', status: 'completed' as RoutineDayStatus },
    { date: '2024-03-02', status: 'skipped' as RoutineDayStatus },
    { date: '2024-03-03', status: 'unknown' as RoutineDayStatus },
  ];

  it('renders distinct accessibility labels per state', () => {
    const { getByLabelText } = render(
      <RoutineStreakCalendar
        year={2024}
        month={2}
        days={days}
        state="ready"
        onPreviousMonth={jest.fn()}
        onNextMonth={jest.fn()}
      />,
    );

    expect(getByLabelText(/completed/i)).toBeTruthy();
    expect(getByLabelText(/skipped/i)).toBeTruthy();
    expect(getByLabelText(/unknown|no data/i)).toBeTruthy();
  });

  it('does not label unknown days as skipped', () => {
    const { queryByLabelText } = render(
      <RoutineStreakCalendar
        year={2024}
        month={2}
        days={[{ date: '2024-03-03', status: 'unknown' }]}
        state="ready"
        onPreviousMonth={jest.fn()}
        onNextMonth={jest.fn()}
      />,
    );

    expect(queryByLabelText(/2024-03-03.*skipped/i)).toBeNull();
    expect(queryByLabelText(/2024-03-03.*unknown|2024-03-03.*no data/i)).toBeTruthy();
  });

  it('invokes date navigation callbacks', () => {
    const onPreviousMonth = jest.fn();
    const onNextMonth = jest.fn();

    const { getByLabelText } = render(
      <RoutineStreakCalendar
        year={2024}
        month={2}
        days={days}
        state="ready"
        onPreviousMonth={onPreviousMonth}
        onNextMonth={onNextMonth}
      />,
    );

    act(() => {
      getByLabelText(/previous month/i).props.onPress();
    });
    act(() => {
      getByLabelText(/next month/i).props.onPress();
    });

    expect(onPreviousMonth).toHaveBeenCalledTimes(1);
    expect(onNextMonth).toHaveBeenCalledTimes(1);
  });

  it('shows permission-denied message instead of empty state', () => {
    const { getByText, queryByText } = render(
      <RoutineStreakCalendar
        year={2024}
        month={2}
        days={[]}
        state="permission-denied"
        onPreviousMonth={jest.fn()}
        onNextMonth={jest.fn()}
      />,
    );

    expect(getByText(/permission/i)).toBeTruthy();
    expect(queryByText(/no events/i)).toBeNull();
  });

  it('shows stale indicator when data is cached/offline', () => {
    const { getByText } = render(
      <RoutineStreakCalendar
        year={2024}
        month={2}
        days={days}
        state="stale"
        isStale
        onPreviousMonth={jest.fn()}
        onNextMonth={jest.fn()}
      />,
    );

    expect(getByText(/offline|stale|cached/i)).toBeTruthy();
  });
});