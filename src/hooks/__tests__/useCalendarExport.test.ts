/**
 * Issue #1186 — useCalendarExport state layer.
 *
 * Covers the server-confirmed gate, the OS permission states the sheet renders
 * differently (never-prompted vs denied vs retryable server block), the
 * selection and retry behaviour, and the rule that removing or revoking synced
 * events works even when export itself is blocked.
 */

import { act, renderHook } from '@testing-library/react-native';

import {
  AppointmentStatus,
  AppointmentType,
  type Appointment,
} from '../../models/Appointment';
import {
  exportAppointments,
  getSyncedAppointments,
  loadCalendarPreferences,
  removeAllSyncedAppointments,
  removeSyncedAppointment,
  revokeCalendarSync,
  saveCalendarPreferences,
  type CalendarExportItemResult,
  type CalendarExportResult,
  type CalendarSyncRecord,
} from '../../services/calendarSyncService';
import {
  fetchFeatureAvailability,
  resolveFeatureAvailability,
} from '../../services/featureAvailabilityService';
import {
  describeCalendarExportState,
  getCalendarExportPermissionState,
  requestPermission,
  type CalendarExportPermissionResult,
} from '../../utils/permissions';
import { useCalendarExport } from '../useCalendarExport';

jest.mock('../../services/calendarSyncService', () => ({
  DEFAULT_CALENDAR_EXPORT_PREFERENCES: { syncEnabled: false, includePetDetails: false },
  exportAppointments: jest.fn(),
  getSyncedAppointments: jest.fn(),
  loadCalendarPreferences: jest.fn(),
  removeAllSyncedAppointments: jest.fn(),
  removeSyncedAppointment: jest.fn(),
  revokeCalendarSync: jest.fn(),
  saveCalendarPreferences: jest.fn(),
}));

jest.mock('../../utils/permissions', () => ({
  PermissionType: { CALENDAR: 'CALENDAR' },
  getCalendarExportPermissionState: jest.fn(),
  describeCalendarExportState: jest.fn(),
  requestPermission: jest.fn(),
}));

jest.mock('../../services/featureAvailabilityService', () => ({
  fetchFeatureAvailability: jest.fn(),
  resolveFeatureAvailability: jest.fn(),
}));

function makeAppointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: 'appt-1',
    petId: 'pet-1',
    vetId: 'vet-1',
    date: '2026-06-15',
    time: '10:30',
    type: AppointmentType.ROUTINE_CHECKUP,
    status: AppointmentStatus.CONFIRMED,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    title: 'Annual checkup',
    petName: 'Bella',
    ...overrides,
  };
}

function permissionResult(
  overrides: Partial<CalendarExportPermissionResult> = {},
): CalendarExportPermissionResult {
  return {
    osStatus: 'granted',
    serverConfirmed: true,
    canExport: true,
    reason: 'available',
    ...overrides,
  };
}

function exportRun(
  items: CalendarExportItemResult[],
  blocked: CalendarExportResult['blocked'] = null,
): CalendarExportResult {
  const count = (outcome: string) => items.filter((item) => item.outcome === outcome).length;
  return {
    items,
    created: count('created'),
    updated: count('updated'),
    unchanged: count('unchanged'),
    adopted: count('adopted'),
    recreated: count('recreated'),
    failed: count('failed'),
    blocked,
  };
}

function record(appointmentId: string): CalendarSyncRecord {
  return {
    appointmentId,
    eventId: `evt-${appointmentId}`,
    revision: 'rev',
    includePetDetails: false,
    syncedAt: '2026-06-02T00:00:00.000Z',
  };
}

const APPTS = [makeAppointment(), makeAppointment({ id: 'appt-2', title: 'Vaccination' })];

/** Drains the async reads the hook starts on mount. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderSettled() {
  const view = renderHook(() => useCalendarExport());
  await flush();
  return view;
}

beforeEach(() => {
  // `resetMocks` wipes the factory implementations, so every mock used by the
  // hook gets its behaviour restated here.
  (describeCalendarExportState as jest.Mock).mockImplementation(
    (reason: string) => `blocked:${reason}`,
  );
  (getCalendarExportPermissionState as jest.Mock).mockResolvedValue(permissionResult());
  (loadCalendarPreferences as jest.Mock).mockResolvedValue({
    syncEnabled: false,
    includePetDetails: false,
  });
  (getSyncedAppointments as jest.Mock).mockResolvedValue([]);
  (exportAppointments as jest.Mock).mockResolvedValue(exportRun([]));
  (saveCalendarPreferences as jest.Mock).mockResolvedValue({
    syncEnabled: false,
    includePetDetails: true,
  });
  (removeSyncedAppointment as jest.Mock).mockResolvedValue('removed');
  (removeAllSyncedAppointments as jest.Mock).mockResolvedValue({
    removed: 1,
    alreadyGone: 0,
    failed: 0,
  });
  (revokeCalendarSync as jest.Mock).mockResolvedValue({ removed: 1, alreadyGone: 0, failed: 0 });
  (requestPermission as jest.Mock).mockResolvedValue({ status: 'granted' });
  (fetchFeatureAvailability as jest.Mock).mockResolvedValue(null);
  (resolveFeatureAvailability as jest.Mock).mockReturnValue('enabled');
});

describe('#1186 gating', () => {
  it('reads as loading until the device and account state has been checked', async () => {
    const { result } = renderHook(() => useCalendarExport());

    expect(result.current.status).toBe('loading');
    expect(result.current.stateKind).toBeNull();

    await flush();
    expect(result.current.status).toBe('ready');
  });

  it('passes the server-confirmed feature state down and never prompts on its own', async () => {
    const { result } = await renderSettled();

    expect(getCalendarExportPermissionState).toHaveBeenCalledWith({
      confirmed: true,
      status: 'enabled',
    });
    expect(requestPermission).not.toHaveBeenCalled();
    expect(result.current.status).toBe('ready');
  });

  it('treats a never-prompted permission as actionable, not as a denial', async () => {
    (getCalendarExportPermissionState as jest.Mock).mockResolvedValue(
      permissionResult({ osStatus: 'undetermined', canExport: false, reason: 'os-undetermined' }),
    );

    const { result } = await renderSettled();

    expect(result.current.status).toBe('permission_undetermined');
    expect(result.current.stateKind).toBeNull();
    expect(result.current.blockerMessage).toBe('blocked:os-undetermined');
  });

  it('treats an OS denial as terminal: no retry affordance', async () => {
    (getCalendarExportPermissionState as jest.Mock).mockResolvedValue(
      permissionResult({ osStatus: 'denied', canExport: false, reason: 'os-denied' }),
    );

    const { result } = await renderSettled();

    expect(result.current.status).toBe('permission_denied');
    expect(result.current.stateKind).toBe('permission-denied');
    expect(result.current.blockerMessage).toBe('blocked:os-denied');
  });

  it('keeps an unconfirmed account retryable', async () => {
    (getCalendarExportPermissionState as jest.Mock).mockResolvedValue(
      permissionResult({ serverConfirmed: false, canExport: false, reason: 'server-unconfirmed' }),
    );

    const { result } = await renderSettled();

    expect(result.current.status).toBe('server_unconfirmed');
    expect(result.current.stateKind).toBe('server-error');
  });

  it('reports server maintenance ahead of an otherwise granted permission', async () => {
    (resolveFeatureAvailability as jest.Mock).mockReturnValue('maintenance');
    (getCalendarExportPermissionState as jest.Mock).mockResolvedValue(
      permissionResult({ serverConfirmed: false, canExport: false, reason: 'server-maintenance' }),
    );

    const { result } = await renderSettled();

    expect(result.current.status).toBe('server_maintenance');
    expect(getCalendarExportPermissionState).toHaveBeenCalledWith({
      confirmed: false,
      status: 'maintenance',
    });
  });

  it('reads an account the server has not enabled as a denial, not a retry', async () => {
    (resolveFeatureAvailability as jest.Mock).mockReturnValue('unavailable');
    (getCalendarExportPermissionState as jest.Mock).mockResolvedValue(
      permissionResult({ serverConfirmed: false, canExport: false, reason: 'server-unconfirmed' }),
    );

    const { result } = await renderSettled();

    expect(result.current.status).toBe('permission_denied');
    expect(result.current.stateKind).toBe('permission-denied');
  });

  it('re-checks both the feature and the permission on refresh', async () => {
    const { result } = await renderSettled();

    await act(async () => {
      await result.current.refresh();
    });

    expect(fetchFeatureAvailability).toHaveBeenCalledTimes(2);
    expect(getCalendarExportPermissionState).toHaveBeenCalledTimes(2);
  });
});

describe('#1186 selection', () => {
  it('toggles rows and reports them back as selected', async () => {
    const { result } = await renderSettled();

    act(() => result.current.toggle('appt-1'));
    expect(result.current.isSelected('appt-1')).toBe(true);
    expect(result.current.selectedIds).toEqual(['appt-1']);

    act(() => result.current.toggle('appt-1'));
    expect(result.current.isSelected('appt-1')).toBe(false);
  });

  it('selects all without duplicating an id offered twice', async () => {
    const { result } = await renderSettled();

    act(() => result.current.selectAll(['appt-1', 'appt-2', 'appt-1']));
    expect(result.current.selectedIds).toEqual(['appt-1', 'appt-2']);

    act(() => result.current.clearSelection());
    expect(result.current.selectedIds).toEqual([]);
  });

  it('exports the selection with the privacy opt-in and the explicit-choice flag', async () => {
    const { result } = await renderSettled();

    act(() => result.current.selectAll(['appt-1']));
    await act(async () => {
      await result.current.exportSelected(APPTS);
    });

    expect(exportAppointments).toHaveBeenCalledWith(
      [APPTS[0]],
      expect.objectContaining({ serverConfirmed: true, explicitSelection: true }),
    );
  });

  it('drops an id that is no longer in the list instead of exporting stale data', async () => {
    const { result } = await renderSettled();

    act(() => result.current.selectAll(['appt-1', 'appt-cancelled']));
    await act(async () => {
      await result.current.exportSelected([APPTS[0]]);
    });

    expect(exportAppointments).toHaveBeenCalledWith([APPTS[0]], expect.anything());
  });

  it('writes nothing when no appointment is picked', async () => {
    const { result } = await renderSettled();

    let returned: CalendarExportResult | null = exportRun([]);
    await act(async () => {
      returned = await result.current.exportSelected(APPTS);
    });

    expect(returned).toBeNull();
    expect(exportAppointments).not.toHaveBeenCalled();
  });

  it('ignores a second export started while the first is still running', async () => {
    let release!: (value: CalendarExportResult) => void;
    const gate = new Promise<CalendarExportResult>((resolve) => {
      release = resolve;
    });
    (exportAppointments as jest.Mock).mockReturnValue(gate);

    const { result } = await renderSettled();
    act(() => result.current.selectAll(['appt-1', 'appt-2']));

    let second: CalendarExportResult | null = exportRun([]);
    await act(async () => {
      const first = result.current.exportSelected(APPTS);
      second = await result.current.exportSelected(APPTS);
      release(exportRun([{ appointmentId: 'appt-1', outcome: 'created' }]));
      await first;
    });

    expect(second).toBeNull();
    expect(exportAppointments).toHaveBeenCalledTimes(1);
    expect(result.current.isExporting).toBe(false);
  });

  it('keeps the result after the run so the summary survives a re-render', async () => {
    (exportAppointments as jest.Mock).mockResolvedValue(
      exportRun([{ appointmentId: 'appt-1', outcome: 'created' }]),
    );

    const { result } = await renderSettled();
    act(() => result.current.toggle('appt-1'));
    await act(async () => {
      await result.current.exportSelected(APPTS);
    });

    expect(result.current.result?.created).toBe(1);
    expect(result.current.failedIds).toEqual([]);
  });

  it('re-exports only the appointments that failed, and nothing when none did', async () => {
    (exportAppointments as jest.Mock).mockResolvedValue(
      exportRun([
        { appointmentId: 'appt-1', outcome: 'created' },
        { appointmentId: 'appt-2', outcome: 'failed' },
      ]),
    );

    const { result } = await renderSettled();
    act(() => result.current.selectAll(['appt-1', 'appt-2']));
    await act(async () => {
      await result.current.exportSelected(APPTS);
    });

    expect(result.current.failedIds).toEqual(['appt-2']);

    await act(async () => {
      await result.current.retryFailed(APPTS);
    });

    expect(exportAppointments).toHaveBeenCalledTimes(2);
    expect(exportAppointments).toHaveBeenLastCalledWith([APPTS[1]], expect.anything());

    (exportAppointments as jest.Mock).mockResolvedValue(exportRun([]));
    let retried: CalendarExportResult | null = exportRun([]);
    await act(async () => {
      retried = await result.current.retryFailed([makeAppointment({ id: 'appt-9' })]);
    });

    expect(retried).toBeNull();
    expect(exportAppointments).toHaveBeenCalledTimes(2);
  });

  it('stops passing the server gate once the account is not entitled', async () => {
    (resolveFeatureAvailability as jest.Mock).mockReturnValue('unavailable');
    (exportAppointments as jest.Mock).mockResolvedValue(exportRun([], 'server_unconfirmed'));

    const { result } = await renderSettled();
    act(() => result.current.toggle('appt-1'));
    await act(async () => {
      await result.current.exportSelected(APPTS);
    });

    expect(exportAppointments).toHaveBeenCalledWith(
      [APPTS[0]],
      expect.objectContaining({ serverConfirmed: false }),
    );
    expect(result.current.result?.blocked).toBe('server_unconfirmed');
  });
});

describe('#1186 privacy opt-in', () => {
  it('stores the opt-in and reflects what was written back', async () => {
    const { result } = await renderSettled();

    await act(async () => {
      await result.current.setIncludePetDetails(true);
    });

    expect(saveCalendarPreferences).toHaveBeenCalledWith({ includePetDetails: true });
    expect(result.current.preferences.includePetDetails).toBe(true);
  });

  it('defaults the exported events to the stored privacy setting', async () => {
    (loadCalendarPreferences as jest.Mock).mockResolvedValue({
      syncEnabled: true,
      includePetDetails: true,
    });

    const { result } = await renderSettled();
    act(() => result.current.toggle('appt-1'));
    await act(async () => {
      await result.current.exportSelected(APPTS);
    });

    expect(exportAppointments).toHaveBeenCalledWith(
      [APPTS[0]],
      expect.objectContaining({ includePetDetails: true }),
    );
  });

  it('asks for calendar access only when the user requests it', async () => {
    const { result } = await renderSettled();

    let reason: string | undefined;
    await act(async () => {
      reason = await result.current.requestAccess();
    });

    expect(requestPermission).toHaveBeenCalledWith('CALENDAR');
    expect(getCalendarExportPermissionState).toHaveBeenCalledTimes(2);
    expect(reason).toBe('available');
  });
});

describe('#1186 removal and revocation', () => {
  it('removes one synced event and reloads the device list', async () => {
    (getSyncedAppointments as jest.Mock)
      .mockResolvedValueOnce([record('appt-1'), record('appt-2')])
      .mockResolvedValue([record('appt-2')]);

    const { result } = await renderSettled();
    expect(result.current.records).toHaveLength(2);

    await act(async () => {
      await result.current.removeOne('appt-1');
    });

    expect(removeSyncedAppointment).toHaveBeenCalledWith('appt-1');
    expect(result.current.records).toHaveLength(1);
    expect(result.current.removalMessage).toBe(
      '1 removed from your calendar. Your appointments are unchanged.',
    );
  });

  it('removes what is already on the device even while export is blocked', async () => {
    (resolveFeatureAvailability as jest.Mock).mockReturnValue('unavailable');
    (getCalendarExportPermissionState as jest.Mock).mockResolvedValue(
      permissionResult({ osStatus: 'denied', canExport: false, reason: 'os-denied' }),
    );
    (getSyncedAppointments as jest.Mock).mockResolvedValue([record('appt-1')]);

    const { result } = await renderSettled();
    expect(result.current.status).toBe('permission_denied');

    await act(async () => {
      await result.current.removeAll();
    });

    expect(removeAllSyncedAppointments).toHaveBeenCalledTimes(1);
    expect(result.current.result).toBeNull();
    expect(result.current.removalMessage).toContain('Your appointments are unchanged');
  });

  it('revokes sync, clears the selection and re-reads the opt-ins', async () => {
    (getSyncedAppointments as jest.Mock)
      .mockResolvedValueOnce([record('appt-1')])
      .mockResolvedValue([]);

    const { result } = await renderSettled();
    act(() => result.current.toggle('appt-1'));

    await act(async () => {
      await result.current.revoke();
    });

    expect(revokeCalendarSync).toHaveBeenCalledTimes(1);
    expect(result.current.selectedIds).toEqual([]);
    expect(result.current.records).toHaveLength(0);
    expect(loadCalendarPreferences).toHaveBeenCalled();
  });

  it('names a removal that failed instead of staying silent', async () => {
    (removeSyncedAppointment as jest.Mock).mockResolvedValue('failed');
    (getSyncedAppointments as jest.Mock).mockResolvedValue([record('appt-1')]);

    const { result } = await renderSettled();

    await act(async () => {
      await result.current.removeOne('appt-1');
    });

    expect(result.current.removalMessage).toBe(
      '1 could not be removed. Your appointments are unchanged.',
    );
  });
});
