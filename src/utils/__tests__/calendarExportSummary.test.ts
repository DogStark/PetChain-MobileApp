/**
 * Issue #1186 — calendar export copy and selection rules.
 *
 * Pure functions, so the wording a screen reader speaks is tested without a
 * renderer (see docs/ACCESSIBILITY.md).
 */

import {
  AppointmentStatus,
  AppointmentType,
  type Appointment,
} from '../../models/Appointment';
import type { CalendarExportResult } from '../../services/calendarSyncService';
import {
  buildAppointmentEventLabel,
  calendarExportSummaryText,
  calendarPrivacyText,
  calendarRemovalSummaryText,
  calendarSelectionAnnouncement,
  isExportableAppointment,
} from '../calendarExportSummary';

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

function exportResult(
  overrides: Partial<CalendarExportResult> & { items?: CalendarExportResult['items'] } = {},
): CalendarExportResult {
  const items = overrides.items ?? [];
  const count = (outcome: string) => items.filter((item) => item.outcome === outcome).length;
  return {
    items,
    created: count('created'),
    updated: count('updated'),
    unchanged: count('unchanged'),
    adopted: count('adopted'),
    recreated: count('recreated'),
    failed: count('failed'),
    blocked: null,
    ...overrides,
  };
}

describe('#1186 isExportableAppointment', () => {
  it('offers a confirmed booking for export', () => {
    expect(isExportableAppointment(makeAppointment())).toBe(true);
  });

  it('offers a completed visit, so past treatments stay planable', () => {
    const completed = makeAppointment({ status: AppointmentStatus.COMPLETED });
    expect(isExportableAppointment(completed)).toBe(true);
  });

  it('excludes cancelled and no-show slots', () => {
    const cancelled = makeAppointment({ status: AppointmentStatus.CANCELLED });
    const noShow = makeAppointment({ status: AppointmentStatus.NO_SHOW });

    expect(isExportableAppointment(cancelled)).toBe(false);
    expect(isExportableAppointment(noShow)).toBe(false);
  });

  it('excludes an entry with no id, which could never be tracked', () => {
    expect(isExportableAppointment(makeAppointment({ id: '' }))).toBe(false);
    expect(isExportableAppointment(null as unknown as Appointment)).toBe(false);
  });
});

describe('#1186 row labels', () => {
  it('names what, who and when, in that order', () => {
    const label = buildAppointmentEventLabel(makeAppointment(), {
      when: 'June 15, 2026, 10:30 AM',
      synced: false,
    });

    expect(label).toBe('Annual checkup for Bella, June 15, 2026, 10:30 AM');
  });

  it('states the sync result in words, not by colour', () => {
    const label = buildAppointmentEventLabel(makeAppointment(), { when: '', synced: true });

    expect(label).toBe('Annual checkup for Bella, already in your calendar');
  });

  it('falls back to a generic word and no pet name when the record lacks them', () => {
    const label = buildAppointmentEventLabel(makeAppointment({ title: '', petName: '' }), {
      when: 'June 15, 2026, 10:30 AM',
      synced: false,
    });

    expect(label).toBe('Appointment, June 15, 2026, 10:30 AM');
  });

  it('uses the nested pet summary when the denormalized name is absent', () => {
    const appt = makeAppointment({ petName: undefined });
    appt.pet = { petId: 'pet-1', name: 'Bella', species: 'Dog' };

    expect(buildAppointmentEventLabel(appt, { when: '', synced: false })).toBe(
      'Annual checkup for Bella',
    );
  });
});

describe('#1186 selection announcement', () => {
  it('says there is nothing to pick when the list is empty', () => {
    expect(calendarSelectionAnnouncement(0, 0)).toBe('No appointments available to export.');
  });

  it('says none are selected rather than leaving it implied', () => {
    expect(calendarSelectionAnnouncement(0, 4)).toBe('4 appointments available. None selected.');
  });

  it('distinguishes a partial selection from selecting all', () => {
    expect(calendarSelectionAnnouncement(2, 4)).toBe('2 of 4 appointments selected.');
    expect(calendarSelectionAnnouncement(4, 4)).toBe('All 4 appointments selected.');
  });
});

describe('#1186 export result wording', () => {
  it('explains a permission denial as nothing being exported', () => {
    expect(calendarExportSummaryText(exportResult({ blocked: 'permission_denied' }))).toBe(
      'Calendar access was not granted, so nothing was exported.',
    );
  });

  it('explains an unconfirmed account separately from a denial', () => {
    expect(calendarExportSummaryText(exportResult({ blocked: 'server_unconfirmed' }))).toBe(
      'Your account has not confirmed calendar export yet, so nothing was exported.',
    );
  });

  it('names each outcome, including the ones that wrote nothing', () => {
    const result = exportResult({
      items: [
        { appointmentId: 'a', outcome: 'created' },
        { appointmentId: 'b', outcome: 'updated' },
        { appointmentId: 'c', outcome: 'recreated' },
        { appointmentId: 'd', outcome: 'adopted' },
        { appointmentId: 'e', outcome: 'unchanged' },
      ],
    });

    expect(calendarExportSummaryText(result)).toBe(
      '1 added, 1 updated, 1 re-added after being deleted on this device, ' +
        '1 matched to events already in your calendar, 1 already up to date.',
    );
  });

  it('offers a retry only for failures, and says appointment data is untouched', () => {
    const result = exportResult({ items: [{ appointmentId: 'a', outcome: 'failed' }] });

    expect(calendarExportSummaryText(result)).toBe(
      '1 could not be written. Retry the failed ones — your appointment data is untouched.',
    );
  });

  it('does not call an empty selection a failure', () => {
    expect(calendarExportSummaryText(exportResult())).toBe(
      'No appointments were selected, so nothing was exported.',
    );
  });
});

describe('#1186 privacy and removal wording', () => {
  it('states the private default rather than implying it', () => {
    expect(calendarPrivacyText(false)).toContain('no pet name and no notes');
  });

  it('warns about other readers once pet detail is on', () => {
    expect(calendarPrivacyText(true)).toContain('lock-screen previews');
  });

  it('confirms appointments survive a removal', () => {
    expect(calendarRemovalSummaryText({ removed: 2, alreadyGone: 1, failed: 0 })).toBe(
      '2 removed from your calendar, 1 were already deleted. Your appointments are unchanged.',
    );
  });

  it('says so when the calendar had no PetChain events', () => {
    expect(calendarRemovalSummaryText({ removed: 0, alreadyGone: 0, failed: 0 })).toBe(
      'No PetChain events were in your calendar.',
    );
  });
});
