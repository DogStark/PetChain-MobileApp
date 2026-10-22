/**
 * useCalendarExport — state layer for exporting appointments to the device
 * calendar (issue #1186).
 *
 * Owns everything the export sheet needs and nothing else:
 *  - server-confirmed availability, read through `useFeatureAvailability`, so an
 *    account the server has not enabled cannot write events;
 *  - the OS calendar permission, checked without ever prompting until the user
 *    asks for it;
 *  - the multi-selection of appointments to export;
 *  - the privacy opt-in for including pet name and notes in event bodies
 *    (default: off, and off again on revoke);
 *  - the per-appointment sync records the service keeps, so the UI can list and
 *    remove what is on the device.
 *
 * Offline behaviour matches the rest of the app: the calendar is a device
 * resource, so exporting works while offline once permission and availability
 * are settled, and removing or revoking synced events never needs the network.
 * A denial is never offered a retry; a server block is.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { StateKind } from '../components/StateView';
import type { Appointment } from '../models/Appointment';
import {
  DEFAULT_CALENDAR_EXPORT_PREFERENCES,
  exportAppointments,
  getSyncedAppointments,
  loadCalendarPreferences,
  removeAllSyncedAppointments,
  removeSyncedAppointment,
  revokeCalendarSync,
  saveCalendarPreferences,
  type CalendarExportItemResult,
  type CalendarExportPreferences,
  type CalendarExportResult,
  type CalendarSyncRecord,
} from '../services/calendarSyncService';
import type { FeatureAvailabilityState } from '../services/featureAvailabilityService';
import { calendarRemovalSummaryText } from '../utils/calendarExportSummary';
import {
  describeCalendarExportState,
  getCalendarExportPermissionState,
  requestPermission,
  PermissionType,
  type CalendarExportPermissionResult,
  type CalendarExportState,
} from '../utils/permissions';
import { useFeatureAvailability } from './useFeatureAvailability';

/** Which explanation/action the export sheet should show instead of the list. */
export type CalendarExportStatus =
  | 'loading'
  | 'ready'
  /** Calendar access has not been granted yet — the sheet can ask for it. */
  | 'permission_undetermined'
  /** Calendar access (or the account's entitlement) was refused: no retry. */
  | 'permission_denied'
  | 'server_unconfirmed'
  | 'server_maintenance';

export interface UseCalendarExportResult {
  /** coarse status the sheet renders from; `ready` shows the selection UI */
  status: CalendarExportStatus;
  /** the shared offline-first state taxonomy for a blocked sheet, else `null` */
  stateKind: StateKind | null;
  /** human explanation for the current blocker, else `null` */
  blockerMessage: string | null;
  /** raw OS + server permission result, or `null` before the first check */
  permission: CalendarExportPermissionResult | null;
  /** server-confirmed availability for this account */
  featureState: FeatureAvailabilityState;
  /** stored opt-ins (export enabled, pet details included) */
  preferences: CalendarExportPreferences;
  /** appointment ids currently selected in the sheet */
  selectedIds: string[];
  /** events on the device that came from PetChain */
  records: CalendarSyncRecord[];
  /** last export run, kept so the result summary survives closing the sheet */
  result: CalendarExportResult | null;
  /** wording for the last remove-all / revoke, else `null` */
  removalMessage: string | null;
  /** appointments whose last export attempt failed — the retry target */
  failedIds: string[];
  isExporting: boolean;
  isRemoving: boolean;

  isSelected: (appointmentId: string) => boolean;
  toggle: (appointmentId: string) => void;
  selectAll: (appointmentIds: string[]) => void;
  clearSelection: () => void;

  /** Prompts for calendar access, then re-reads the combined permission state. */
  requestAccess: () => Promise<CalendarExportState>;
  setIncludePetDetails: (includePetDetails: boolean) => Promise<void>;
  /** Export the current selection. Returns `null` when blocked or nothing picked. */
  exportSelected: (appointments: Appointment[]) => Promise<CalendarExportResult | null>;
  /** Re-run the export for the appointments that failed last time. */
  retryFailed: (appointments: Appointment[]) => Promise<CalendarExportResult | null>;
  removeOne: (appointmentId: string) => Promise<void>;
  removeAll: () => Promise<void>;
  /** Delete every synced event, clear the records and turn both opt-ins off. */
  revoke: () => Promise<void>;
  /** Re-read permission, records and preferences — the retry for a server block. */
  refresh: () => Promise<void>;
}

function statusFromPermission(
  permission: CalendarExportPermissionResult,
  featureState: FeatureAvailabilityState,
): CalendarExportStatus {
  // The account's entitlement is checked first: a feature the server has not
  // enabled is an access denial, not something a retry can fix.
  if (featureState === 'maintenance') return 'server_maintenance';
  if (featureState === 'unavailable') return 'permission_denied';
  if (permission.reason === 'os-denied' || permission.reason === 'os-restricted') {
    return 'permission_denied';
  }
  if (permission.reason === 'os-undetermined') return 'permission_undetermined';
  if (!permission.canExport) {
    return permission.reason === 'server-maintenance' ? 'server_maintenance' : 'server_unconfirmed';
  }
  return 'ready';
}

function stateKindFor(status: CalendarExportStatus): StateKind | null {
  switch (status) {
    case 'permission_denied':
      return 'permission-denied';
    case 'server_unconfirmed':
    case 'server_maintenance':
      // Not a denial and not empty: the account state could not be confirmed,
      // which is retryable once there is connectivity.
      return 'server-error';
    default:
      // `permission_undetermined` is actionable, not a denied state: the sheet
      // offers the access prompt instead of a StateView.
      return null;
  }
}

export function useCalendarExport(): UseCalendarExportResult {
  const { state: featureState, loading: featureLoading, refresh: refreshFeature } =
    useFeatureAvailability('calendarExport');

  const [permission, setPermission] = useState<CalendarExportPermissionResult | null>(null);
  const [preferences, setPreferences] = useState<CalendarExportPreferences>(
    DEFAULT_CALENDAR_EXPORT_PREFERENCES,
  );
  const [records, setRecords] = useState<CalendarSyncRecord[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [result, setResult] = useState<CalendarExportResult | null>(null);
  const [removalMessage, setRemovalMessage] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);

  const mountedRef = useRef(true);
  // One export or removal at a time: the calendar providers do not like
  // overlapping write batches, and a double tap must not run two of them.
  const writeInFlightRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // ── Read device + account state (never prompts) ────────────────────────────

  const readState = useCallback(async () => {
    const [nextPermission, nextPreferences, nextRecords] = await Promise.all([
      getCalendarExportPermissionState({
        confirmed: featureState === 'enabled',
        status:
          featureState === 'maintenance'
            ? 'maintenance'
            : featureState === 'unavailable'
              ? 'disabled'
              : 'enabled',
      }),
      loadCalendarPreferences(),
      getSyncedAppointments(),
    ]);
    if (!mountedRef.current) return nextPermission;
    setPermission(nextPermission);
    setPreferences(nextPreferences);
    setRecords(nextRecords);
    return nextPermission;
  }, [featureState]);

  useEffect(() => {
    void readState();
  }, [readState]);

  // ── Selection ──────────────────────────────────────────────────────────────

  const isSelected = useCallback(
    (appointmentId: string) => selectedIds.includes(appointmentId),
    [selectedIds],
  );

  const toggle = useCallback((appointmentId: string) => {
    setSelectedIds((prev) =>
      prev.includes(appointmentId)
        ? prev.filter((id) => id !== appointmentId)
        : [...prev, appointmentId],
    );
  }, []);

  const selectAll = useCallback((appointmentIds: string[]) => {
    setSelectedIds(Array.from(new Set(appointmentIds)));
  }, []);

  const clearSelection = useCallback(() => setSelectedIds([]), []);

  // ── Opt-ins ────────────────────────────────────────────────────────────────

  /**
   * Ask for calendar access. Called from the sheet's primary action so the
   * system prompt only appears once the user has decided to export.
   */
  const requestAccess = useCallback(async (): Promise<CalendarExportState> => {
    try {
      await requestPermission(PermissionType.CALENDAR);
    } catch {
      // A failed prompt reads as undetermined; the state below still explains it.
    }
    const next = await readState();
    return next.reason;
  }, [readState]);

  const setIncludePetDetails = useCallback(async (includePetDetails: boolean) => {
    // Re-reading after writing keeps the stored value authoritative: an
    // unreadable cache must not be overwritten by stale optimistic state.
    const next = await saveCalendarPreferences({ includePetDetails });
    if (!mountedRef.current) return;
    setPreferences(next);
  }, []);

  // ── Export ─────────────────────────────────────────────────────────────────

  const runExport = useCallback(
    async (appointments: Appointment[]): Promise<CalendarExportResult | null> => {
      if (appointments.length === 0 || writeInFlightRef.current) return null;

      writeInFlightRef.current = true;
      setIsExporting(true);
      try {
        const confirmed = featureState === 'enabled';
        const next = await exportAppointments(appointments, {
          serverConfirmed: confirmed,
          includePetDetails: preferences.includePetDetails,
          explicitSelection: true,
        });
        if (!mountedRef.current) return next;

        setResult(next);
        setRemovalMessage(null);
        setPreferences(await loadCalendarPreferences());
        setRecords(await getSyncedAppointments());
        if (next.blocked === 'permission_denied') void readState();
        return next;
      } finally {
        writeInFlightRef.current = false;
        if (mountedRef.current) setIsExporting(false);
      }
    },
    [featureState, preferences.includePetDetails, readState],
  );

  const exportSelected = useCallback(
    async (appointments: Appointment[]): Promise<CalendarExportResult | null> => {
      // Only appointments that still exist in the current list are exported: an
      // id left over from a cancelled or archived appointment is dropped here
      // instead of being written from stale data.
      const picked = appointments.filter((appt) => selectedIds.includes(appt.id));
      return runExport(picked);
    },
    [runExport, selectedIds],
  );

  const failedIds = useMemo(
    () =>
      (result?.items ?? [])
        .filter((item: CalendarExportItemResult) => item.outcome === 'failed')
        .map((item) => item.appointmentId),
    [result],
  );

  const retryFailed = useCallback(
    async (appointments: Appointment[]) => {
      const retries = appointments.filter((appt) => failedIds.includes(appt.id));
      if (retries.length === 0) return null;
      return runExport(retries);
    },
    [failedIds, runExport],
  );

  // ── Remove / revoke ────────────────────────────────────────────────────────
  // Deliberately independent of server confirmation and connectivity: what is
  // already on this device must always be removable.

  const removeOne = useCallback(async (appointmentId: string) => {
    if (writeInFlightRef.current) return;
    writeInFlightRef.current = true;
    setIsRemoving(true);
    try {
      const outcome = await removeSyncedAppointment(appointmentId);
      if (!mountedRef.current) return;
      setSelectedIds((prev) => prev.filter((id) => id !== appointmentId));
      setResult((prev) =>
        prev
          ? {
              ...prev,
              items: prev.items.filter((item) => item.appointmentId !== appointmentId),
            }
          : prev,
      );
      setRemovalMessage(
        calendarRemovalSummaryText({
          removed: outcome === 'removed' ? 1 : 0,
          alreadyGone: outcome === 'already_gone' ? 1 : 0,
          failed: outcome === 'failed' ? 1 : 0,
        }),
      );
      setRecords(await getSyncedAppointments());
    } finally {
      writeInFlightRef.current = false;
      if (mountedRef.current) setIsRemoving(false);
    }
  }, []);

  const removeAll = useCallback(async () => {
    if (writeInFlightRef.current) return;
    writeInFlightRef.current = true;
    setIsRemoving(true);
    try {
      const summary = await removeAllSyncedAppointments();
      if (!mountedRef.current) return;
      clearSelection();
      setResult(null);
      setRemovalMessage(calendarRemovalSummaryText(summary));
      setRecords(await getSyncedAppointments());
    } finally {
      writeInFlightRef.current = false;
      if (mountedRef.current) setIsRemoving(false);
    }
  }, [clearSelection]);

  const revoke = useCallback(async () => {
    if (writeInFlightRef.current) return;
    writeInFlightRef.current = true;
    setIsRemoving(true);
    try {
      const summary = await revokeCalendarSync();
      if (!mountedRef.current) return;
      clearSelection();
      setResult(null);
      setRemovalMessage(calendarRemovalSummaryText(summary));
      setPreferences(await loadCalendarPreferences());
      setRecords(await getSyncedAppointments());
    } finally {
      writeInFlightRef.current = false;
      if (mountedRef.current) setIsRemoving(false);
    }
  }, [clearSelection]);

  const refresh = useCallback(async () => {
    await refreshFeature();
    await readState();
  }, [readState, refreshFeature]);

  // ── Derived status ─────────────────────────────────────────────────────────

  const status: CalendarExportStatus = useMemo(() => {
    if (featureLoading || permission === null) return 'loading';
    return statusFromPermission(permission, featureState);
  }, [featureLoading, featureState, permission]);

  const blockerMessage = useMemo(() => {
    if (!permission || status === 'ready' || status === 'loading') return null;
    if (status === 'permission_undetermined') return describeCalendarExportState('os-undetermined');
    if (status === 'server_maintenance') return describeCalendarExportState('server-maintenance');
    if (status === 'server_unconfirmed') return describeCalendarExportState('server-unconfirmed');
    // A denied sheet is either the OS refusal or the account not being entitled.
    return describeCalendarExportState(
      permission.reason === 'os-denied' || permission.reason === 'os-restricted'
        ? permission.reason
        : 'server-unconfirmed',
    );
  }, [permission, status]);

  return {
    status,
    stateKind: stateKindFor(status),
    blockerMessage,
    permission,
    featureState,
    preferences,
    selectedIds,
    records,
    result,
    removalMessage,
    failedIds,
    isExporting,
    isRemoving,
    isSelected,
    toggle,
    selectAll,
    clearSelection,
    requestAccess,
    setIncludePetDetails,
    exportSelected,
    retryFailed,
    removeOne,
    removeAll,
    revoke,
    refresh,
  };
}

export default useCalendarExport;
