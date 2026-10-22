/**
 * CalendarExportSheet — pick appointments and write them to the device calendar.
 *
 * Opened from the Appointments header (issue #1186). All state comes from
 * `useCalendarExport` and all wording from the pure `calendarExportSummary`
 * module, so this file stays a thin wrapper — the split documented in
 * docs/ACCESSIBILITY.md:
 *
 *  - selectable rows are real checkboxes: `accessibilityRole="checkbox"` plus
 *    `accessibilityState={{ checked }}` and a ☐/☑ glyph, so the state is never
 *    carried by colour alone;
 *  - the selection count is announced through one polite live region rather
 *    than a popup per tap, and touch targets are at least 44pt;
 *  - the privacy opt-in is a `switch` that is **off by default**, and the copy
 *    states what that default does;
 *  - blocked states are never shown as an empty list: a refusal is
 *    `permission-denied` with no retry, an unconfirmed account is `server-error`
 *    with one, and "not allowed yet" offers the access prompt (`StateView`);
 *  - removing one synced event, removing all of them, or revoking the sync stays
 *    available offline and with an unconfirmed account — what is already on this
 *    device must always be removable.
 */

import React, { useCallback, useMemo } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { useCalendarExport } from '../hooks/useCalendarExport';
import type { Appointment } from '../models/Appointment';
import { resolveAppointmentStart } from '../services/calendarSyncService';
import { useAppTheme } from '../theme';
import {
  buildAppointmentEventLabel,
  calendarExportSummaryText,
  calendarPrivacyText,
  calendarSelectionAnnouncement,
  isExportableAppointment,
} from '../utils/calendarExportSummary';
import { formatLocalDateTime } from '../utils/dateLocale';
import AccessibleModal from './AccessibleModal';
import StateView from './StateView';

export interface CalendarExportSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Appointments currently on screen; the sheet filters what can be exported. */
  appointments: Appointment[];
  /** Focus returns here when the sheet closes. */
  returnFocusRef?: React.RefObject<View | null>;
}

/** Smallest comfortable touch target (WCAG 2.5.5). */
const TOUCH_TARGET = 44;

export function CalendarExportSheet({
  visible,
  onClose,
  appointments,
  returnFocusRef,
}: CalendarExportSheetProps) {
  const colors = useAppTheme();
  const {
    status,
    stateKind,
    blockerMessage,
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
  } = useCalendarExport();

  const exportable = useMemo(() => appointments.filter(isExportableAppointment), [appointments]);
  const syncedIds = useMemo(
    () => new Set(records.map((record) => record.appointmentId)),
    [records],
  );
  // Look-up for the synced list uses every appointment, not just the exportable
  // ones: a cancelled visit still has an event on the device until it is removed.
  const byId = useMemo(() => new Map(appointments.map((a) => [a.id, a])), [appointments]);

  const secondary = { color: colors.secondaryText };
  const canWrite = selectedIds.length > 0 && !isExporting;
  const busy = isExporting || isRemoving;

  const announcement = useMemo(
    () => calendarSelectionAnnouncement(selectedIds.length, exportable.length),
    [selectedIds.length, exportable.length],
  );

  const handleExport = useCallback(async () => {
    const run = await exportSelected(exportable);
    if (run && !run.blocked) clearSelection();
  }, [clearSelection, exportable, exportSelected]);

  const handleRemoveAll = useCallback(() => {
    Alert.alert(
      'Remove all synced events?',
      'This deletes every appointment PetChain added to your calendar. ' +
        'Your appointments stay in PetChain.',
      [
        { text: 'Keep them', style: 'cancel' },
        { text: 'Remove all', style: 'destructive', onPress: () => void removeAll() },
      ],
    );
  }, [removeAll]);

  const handleRevoke = useCallback(() => {
    Alert.alert(
      'Revoke calendar sync?',
      'Removes every PetChain event from your calendar and turns calendar export off, ' +
        'including the pet-name opt-in. Nothing is exported again until you switch it back on.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Revoke sync', style: 'destructive', onPress: () => void revoke() },
      ],
    );
  }, [revoke]);

  const blockLabel = (
    <Text style={[styles.blockerText, secondary]} accessibilityLiveRegion="polite">
      {blockerMessage}
    </Text>
  );

  const renderBlocked = () => {
    if (status === 'loading') {
      return <ActivityIndicator testID="calendar-export-loading" color={colors.primary} />;
    }

    if (status === 'permission_undetermined') {
      // Not a refusal — the prompt has simply never been answered, so asking is
      // the one action that moves the user forward.
      return (
        <View style={styles.blocker}>
          {blockLabel}
          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
            onPress={() => void requestAccess()}
            accessibilityRole="button"
            accessibilityLabel="Allow calendar access"
          >
            <Text style={styles.primaryBtnText}>Allow calendar access</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (stateKind) {
      const retryable = stateKind === 'server-error';
      return (
        <View style={styles.blocker}>
          <StateView
            kind={stateKind}
            action={
              retryable
                ? { label: 'Check again', onPress: () => void refresh(), destructive: false }
                : undefined
            }
          />
          {blockLabel}
        </View>
      );
    }

    return blockLabel;
  };

  const renderRow = (appt: Appointment) => {
    const checked = isSelected(appt.id);
    const synced = syncedIds.has(appt.id);
    // The same start the calendar event will get, so the row and the event agree.
    const when = formatLocalDateTime(resolveAppointmentStart(appt));
    return (
      <TouchableOpacity
        key={appt.id}
        style={[styles.row, { borderColor: colors.border }]}
        onPress={() => toggle(appt.id)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        accessibilityLabel={buildAppointmentEventLabel(appt, { when, synced })}
      >
        <Text style={styles.checkbox} accessibilityHidden>
          {checked ? '☑' : '☐'}
        </Text>
        <View style={styles.rowBody}>
          <Text style={[styles.rowTitle, { color: colors.text }]}>
            {appt.title ?? 'Appointment'}
          </Text>
          <Text style={[styles.rowMeta, secondary]}>{when}</Text>
          {synced ? (
            <Text style={[styles.rowMeta, { color: colors.accent, fontWeight: '600' }]}>
              In your calendar
            </Text>
          ) : null}
        </View>
      </TouchableOpacity>
    );
  };

  const renderSyncedRow = (appointmentId: string, eventId: string) => {
    const appt = byId.get(appointmentId);
    const label = appt
      ? `Remove ${appt.title ?? 'appointment'} from your calendar`
      : 'Remove leftover calendar event';
    return (
      <View key={eventId} style={[styles.row, { borderColor: colors.border }]}>
        <View style={styles.rowBody}>
          <Text style={[styles.rowTitle, { color: colors.text }]}>
            {appt?.title ?? 'Appointment no longer in PetChain'}
          </Text>
          {appt ? (
            <Text style={[styles.rowMeta, secondary]}>
              {formatLocalDateTime(resolveAppointmentStart(appt))}
            </Text>
          ) : (
            // Stale entry: the appointment is gone but the event it produced is
            // still on the device, and still removable.
            <Text style={[styles.rowMeta, { color: colors.warning }]}>
              This appointment is no longer in PetChain.
            </Text>
          )}
        </View>
        <TouchableOpacity
          style={styles.removeBtn}
          onPress={() => void removeOne(appointmentId)}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={{ disabled: busy }}
        >
          <Text style={[styles.linkText, { color: colors.error }]}>Remove</Text>
        </TouchableOpacity>
      </View>
    );
  };

  const renderReady = () => {
    if (exportable.length === 0) {
      // Genuinely nothing to export — never shown for a denied account.
      return <StateView kind="empty" />;
    }

    return (
      <View>
        <View style={styles.selectionBar}>
          <TouchableOpacity
            style={styles.linkBtn}
            onPress={() => selectAll(exportable.map((a) => a.id))}
            accessibilityRole="button"
            accessibilityLabel={`Select all ${exportable.length} appointments`}
          >
            <Text style={[styles.linkText, { color: colors.primary }]}>Select all</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.linkBtn}
            onPress={clearSelection}
            accessibilityRole="button"
            accessibilityLabel="Clear selection"
            accessibilityState={{ disabled: selectedIds.length === 0 }}
            disabled={selectedIds.length === 0}
          >
            <Text style={[styles.linkText, secondary]}>Clear</Text>
          </TouchableOpacity>
        </View>

        <Text style={[styles.rowMeta, secondary]} accessibilityLiveRegion="polite">
          {announcement}
        </Text>

        <ScrollView contentContainerStyle={styles.list} nestedScrollEnabled>
          {exportable.map(renderRow)}
        </ScrollView>

        <TouchableOpacity
          style={styles.privacyRow}
          onPress={() => void setIncludePetDetails(!preferences.includePetDetails)}
          accessibilityRole="switch"
          accessibilityState={{ checked: preferences.includePetDetails }}
          accessibilityLabel="Include pet name and notes in exported events"
        >
          <Text style={styles.checkbox} accessibilityHidden>
            {preferences.includePetDetails ? '☑' : '☐'}
          </Text>
          <View style={styles.rowBody}>
            <Text style={[styles.rowTitle, { color: colors.text }]}>
              Include pet name and notes
            </Text>
            <Text style={[styles.rowMeta, secondary]}>
              {calendarPrivacyText(preferences.includePetDetails)}
            </Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          testID="calendar-export-confirm"
          style={[
            styles.primaryBtn,
            { backgroundColor: colors.primary },
            !canWrite && styles.btnDisabled,
          ]}
          onPress={() => void handleExport()}
          disabled={!canWrite}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canWrite }}
          accessibilityLabel={`Export ${selectedIds.length} selected appointments`}
        >
          <Text style={styles.primaryBtnText}>
            {selectedIds.length > 0 ? `Export ${selectedIds.length}` : 'Select appointments'}
          </Text>
        </TouchableOpacity>

        {result ? (
          <View
            style={[styles.resultBox, { backgroundColor: colors.subtle }]}
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
          >
            <Text style={[styles.rowMeta, secondary]}>{calendarExportSummaryText(result)}</Text>
            {failedIds.length > 0 ? (
              <TouchableOpacity
                style={[styles.secondaryBtn, { borderColor: colors.border }]}
                onPress={() => void retryFailed(exportable)}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel={`Retry ${failedIds.length} failed appointments`}
              >
                <Text style={[styles.linkText, { color: colors.text }]}>Retry failed</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}

        {removalMessage ? (
          <Text style={[styles.rowMeta, secondary]} accessibilityLiveRegion="polite">
            {removalMessage}
          </Text>
        ) : null}

        {records.length > 0 ? (
          <View style={styles.syncedSection}>
            <Text style={[styles.sectionHeader, { color: colors.text }]} accessibilityRole="header">
              {`In your calendar (${records.length})`}
            </Text>
            {records.map((record) => renderSyncedRow(record.appointmentId, record.eventId))}

            <TouchableOpacity
              style={[styles.secondaryBtn, { borderColor: colors.border }]}
              onPress={handleRemoveAll}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Remove all PetChain events from my calendar"
            >
              <Text style={[styles.linkText, { color: colors.text }]}>Remove all events</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.secondaryBtn, { borderColor: colors.border }]}
              onPress={handleRevoke}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Revoke calendar sync and turn off calendar export"
            >
              <Text style={[styles.linkText, { color: colors.error }]}>Revoke calendar sync</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <AccessibleModal
      visible={visible}
      onClose={onClose}
      title="Export to calendar"
      returnFocusRef={returnFocusRef}
      testID="calendar-export-sheet"
    >
      {status === 'ready' ? renderReady() : renderBlocked()}
    </AccessibleModal>
  );
}

const styles = StyleSheet.create({
  blocker: { gap: 12 },
  blockerText: { fontSize: 14, lineHeight: 20 },
  selectionBar: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  linkBtn: { paddingVertical: 10, paddingHorizontal: 4 },
  linkText: { fontSize: 14, fontWeight: '600' },
  list: { gap: 8, marginBottom: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    minHeight: TOUCH_TARGET,
  },
  checkbox: { fontSize: 20, marginRight: 10, lineHeight: 24 },
  rowBody: { flex: 1 },
  rowTitle: { fontSize: 15, fontWeight: '600' },
  rowMeta: { fontSize: 13, marginTop: 2 },
  privacyRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 12,
    minHeight: TOUCH_TARGET,
    marginBottom: 12,
  },
  primaryBtn: {
    minHeight: TOUCH_TARGET,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  primaryBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  btnDisabled: { opacity: 0.5 },
  secondaryBtn: {
    minHeight: TOUCH_TARGET,
    borderWidth: 1,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    marginTop: 8,
  },
  resultBox: { borderRadius: 10, padding: 12, marginTop: 12 },
  syncedSection: { marginTop: 16, gap: 4 },
  sectionHeader: { fontSize: 16, fontWeight: '700', marginBottom: 8 },
  removeBtn: { paddingLeft: 12, justifyContent: 'center', minHeight: TOUCH_TARGET },
});

export default CalendarExportSheet;
