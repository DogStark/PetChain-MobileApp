/**
 * localizedMeasurementEntry.ts
 *
 * Locale-aware date, time, and clinical measurement entry utilities (issue #1197).
 *
 * Key invariants:
 *  1. Unambiguous stored units: every committed measurement carries both a
 *     canonical value (`canonicalValue`, `canonicalUnit`) and the exact user-entered
 *     value (`enteredValue`, `enteredUnit`) so round-trip display never drifts.
 *  2. Zero silent conversion during editing: while a draft is active (`isEditing`),
 *     locale changes or re-renders never rewrite `rawInput` or silently convert
 *     `entryUnit`.
 *  3. Locale-aware parsing & formatting: handles decimal commas (`es-ES`), decimal
 *     points (`en-US`), Eastern Arabic digits (`ar-SA`), and locale date/time
 *     patterns (`MM/DD/YYYY`, `DD/MM/YYYY`, `YYYY-MM-DD`, 12h/24h time).
 *  4. Server-confirmed permissions & offline continuity: validates write permissions
 *     before commit while allowing offline queueing when a cached grant is present.
 *  5. Privacy & accessibility: redacts sensitive pet/owner identifiers by default
 *     and builds screen-reader labels with full spoken unit names.
 */

export type MeasurementCategory = 'weight' | 'temperature' | 'dosage_volume' | 'dosage_mass';

export type WeightUnit = 'kg' | 'lb' | 'g';
export type TemperatureUnit = 'celsius' | 'fahrenheit';
export type DosageVolumeUnit = 'ml';
export type DosageMassUnit = 'mg';

export type MeasurementUnit =
  | WeightUnit
  | TemperatureUnit
  | DosageVolumeUnit
  | DosageMassUnit;

export interface StoredMeasurement {
  category: MeasurementCategory;
  /** Canonical stored value (kg for weight, celsius for temperature, ml/mg for dosage). */
  canonicalValue: number;
  canonicalUnit: 'kg' | 'celsius' | 'ml' | 'mg';
  /** Exact numeric value entered by the user in `enteredUnit`. */
  enteredValue: number;
  /** Explicit unit chosen by the user at entry time. */
  enteredUnit: MeasurementUnit;
  /** ISO-8601 UTC timestamp of when the measurement was recorded. */
  recordedAtIso: string;
  /** True if queued while offline and awaiting server sync. */
  pendingOfflineSync?: boolean;
}

export interface MeasurementEntryDraft {
  category: MeasurementCategory;
  rawInput: string;
  entryUnit: MeasurementUnit;
  localeTag: string;
  isEditing: boolean;
  /** Snapshot of the original stored measurement if editing an existing record. */
  originalStored?: StoredMeasurement;
}

export interface EntryPermissionContext {
  serverConfirmed: boolean;
  canWrite: boolean;
  confirmedAt: number | null;
  staleAfterMs?: number;
  isOffline?: boolean;
  offlineCachedWriteGrant?: boolean;
}

export interface EntryPermissionResult {
  allowed: boolean;
  status: 'confirmed' | 'offline_queued' | 'denied' | 'stale';
  errorMessage?: string;
}

export interface CommitMeasurementResult {
  ok: boolean;
  record?: StoredMeasurement;
  status: 'committed' | 'queued_offline' | 'validation_error' | 'permission_denied' | 'stale_data';
  errorMessage?: string;
  retryable: boolean;
}

export interface ParsedLocalDateResult {
  valid: boolean;
  isoDate?: string; // YYYY-MM-DD
  year?: number;
  month?: number;
  day?: number;
  errorMessage?: string;
}

export interface ParsedLocalTimeResult {
  valid: boolean;
  isoTime?: string; // HH:mm
  hours24?: number;
  minutes?: number;
  errorMessage?: string;
}

const KG_PER_LB = 0.45359237;
const DEFAULT_STALE_WINDOW_MS = 5 * 60 * 1000;

const IMPERIAL_LOCALES = new Set(['en-US', 'en-LR', 'en-MM']);

const SPOKEN_UNIT_NAMES: Record<MeasurementUnit, string> = {
  kg: 'kilograms',
  lb: 'pounds',
  g: 'grams',
  celsius: 'degrees Celsius',
  fahrenheit: 'degrees Fahrenheit',
  ml: 'milliliters',
  mg: 'milligrams',
};

const DISPLAY_UNIT_SYMBOLS: Record<MeasurementUnit, string> = {
  kg: 'kg',
  lb: 'lb',
  g: 'g',
  celsius: '°C',
  fahrenheit: '°F',
  ml: 'mL',
  mg: 'mg',
};

// Bounds per canonical unit to catch accidental unit confusion or extreme typos.
const CANONICAL_BOUNDS: Record<
  MeasurementCategory,
  { min: number; max: number; canonicalUnit: 'kg' | 'celsius' | 'ml' | 'mg' }
> = {
  weight: { min: 0.01, max: 250, canonicalUnit: 'kg' },
  temperature: { min: 25, max: 46, canonicalUnit: 'celsius' },
  dosage_volume: { min: 0.01, max: 1000, canonicalUnit: 'ml' },
  dosage_mass: { min: 0.01, max: 50000, canonicalUnit: 'mg' },
};

const EASTERN_ARABIC_DIGITS: Record<string, string> = {
  '٠': '0',
  '١': '1',
  '٢': '2',
  '٣': '3',
  '٤': '4',
  '٥': '5',
  '٦': '6',
  '٧': '7',
  '٨': '8',
  '٩': '9',
};

const PRIVACY_REDACTION_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\bG[A-Z2-7]{55}\b/g, replacement: '[redacted-address]' },
  { pattern: /\b\d{15}\b/g, replacement: '[redacted-microchip]' },
  {
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    replacement: '[redacted-email]',
  },
  {
    pattern: /\b(?:token|secret|apiKey|medicalRecordId|petSecret)=[^\s,;]+/gi,
    replacement: '[redacted]',
  },
];

/**
 * Redacts sensitive pet/owner identifiers from accessibility labels and error strings.
 */
export function redactMeasurementContext(text?: string | null): string {
  if (!text) return '';
  let result = text.trim();
  for (const { pattern, replacement } of PRIVACY_REDACTION_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

/**
 * Normalizes Eastern Arabic numerals and Arabic decimal/thousands separators.
 */
export function normalizeLocaleDigits(raw: string): string {
  return raw
    .replace(/[٠-٩]/g, (ch) => EASTERN_ARABIC_DIGITS[ch] ?? ch)
    .replace(/٫/g, '.')
    .replace(/٬/g, '');
}

/**
 * Returns the default display/entry unit for a category in the given BCP-47 locale.
 */
export function getDefaultUnitForLocale(
  category: MeasurementCategory,
  localeTag: string = 'en-US',
): MeasurementUnit {
  const imperial = IMPERIAL_LOCALES.has(localeTag);
  switch (category) {
    case 'weight':
      return imperial ? 'lb' : 'kg';
    case 'temperature':
      return imperial ? 'fahrenheit' : 'celsius';
    case 'dosage_volume':
      return 'ml';
    case 'dosage_mass':
      return 'mg';
  }
}

/**
 * Formats a numeric value using the locale's decimal separator without adding
 * grouping separators inside an editable text input.
 */
export function formatNumberForLocaleInput(
  value: number,
  localeTag: string = 'en-US',
  maxFractionDigits: number = 2,
): string {
  if (!Number.isFinite(value)) return '';
  const rounded = Number(value.toFixed(maxFractionDigits));
  const raw = String(rounded);
  if (localeTag.startsWith('es') || localeTag.startsWith('de') || localeTag.startsWith('fr')) {
    return raw.replace('.', ',');
  }
  return raw;
}

/**
 * Parses a locale-formatted numeric string into a finite number.
 * Rejects empty strings, non-numeric characters, or ambiguous multiple decimal separators.
 */
export function parseLocaleNumber(
  rawInput: string,
  localeTag: string = 'en-US',
): number | null {
  if (typeof rawInput !== 'string') return null;
  const trimmed = normalizeLocaleDigits(rawInput).trim();
  if (!trimmed) return null;

  const usesCommaDecimal =
    localeTag.startsWith('es') || localeTag.startsWith('de') || localeTag.startsWith('fr');

  let normalized = trimmed;
  if (usesCommaDecimal) {
    // Reject multiple commas
    const commaCount = (normalized.match(/,/g) ?? []).length;
    const dotCount = (normalized.match(/\./g) ?? []).length;
    if (commaCount > 1 || (commaCount === 1 && dotCount > 0)) {
      return null;
    }
    if (dotCount > 1) {
      return null;
    }
    normalized = normalized.replace(',', '.');
  } else {
    const dotCount = (normalized.match(/\./g) ?? []).length;
    const commaCount = (normalized.match(/,/g) ?? []).length;
    if (dotCount > 1 || commaCount > 1 || (dotCount === 1 && commaCount === 1)) {
      return null;
    }
    normalized = normalized.replace(',', '.');
  }

  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Converts a value between a specific measurement unit and its canonical storage unit.
 */
export function toCanonicalValue(
  value: number,
  unit: MeasurementUnit,
): { canonicalValue: number; canonicalUnit: 'kg' | 'celsius' | 'ml' | 'mg' } {
  switch (unit) {
    case 'kg':
      return { canonicalValue: Number(value.toFixed(4)), canonicalUnit: 'kg' };
    case 'lb':
      return {
        canonicalValue: Number((value * KG_PER_LB).toFixed(4)),
        canonicalUnit: 'kg',
      };
    case 'g':
      return {
        canonicalValue: Number((value / 1000).toFixed(4)),
        canonicalUnit: 'kg',
      };
    case 'celsius':
      return { canonicalValue: Number(value.toFixed(2)), canonicalUnit: 'celsius' };
    case 'fahrenheit':
      return {
        canonicalValue: Number((((value - 32) * 5) / 9).toFixed(2)),
        canonicalUnit: 'celsius',
      };
    case 'ml':
      return { canonicalValue: Number(value.toFixed(3)), canonicalUnit: 'ml' };
    case 'mg':
      return { canonicalValue: Number(value.toFixed(3)), canonicalUnit: 'mg' };
  }
}

/**
 * Converts a canonical value into a target display unit.
 */
export function fromCanonicalValue(canonicalValue: number, targetUnit: MeasurementUnit): number {
  switch (targetUnit) {
    case 'kg':
    case 'celsius':
    case 'ml':
    case 'mg':
      return canonicalValue;
    case 'lb':
      return Number((canonicalValue / KG_PER_LB).toFixed(2));
    case 'g':
      return Number((canonicalValue * 1000).toFixed(1));
    case 'fahrenheit':
      return Number(((canonicalValue * 9) / 5 + 32).toFixed(1));
  }
}

/**
 * Creates an editable draft. If initialized from an existing stored measurement,
 * preserves `existing.enteredValue` and `existing.enteredUnit` so opening an
 * edit form never silently converts or rounds the user's previously entered value.
 */
export function createMeasurementEntryDraft(
  category: MeasurementCategory,
  localeTag: string = 'en-US',
  existing?: StoredMeasurement,
): MeasurementEntryDraft {
  if (existing) {
    return {
      category,
      rawInput: formatNumberForLocaleInput(existing.enteredValue, localeTag),
      entryUnit: existing.enteredUnit,
      localeTag,
      isEditing: true,
      originalStored: existing,
    };
  }

  return {
    category,
    rawInput: '',
    entryUnit: getDefaultUnitForLocale(category, localeTag),
    localeTag,
    isEditing: true,
  };
}

/**
 * Updates the raw text of an active draft without converting or altering the unit.
 */
export function updateMeasurementDraftText(
  draft: MeasurementEntryDraft,
  nextRawInput: string,
): MeasurementEntryDraft {
  return {
    ...draft,
    rawInput: nextRawInput,
    isEditing: true,
  };
}

/**
 * Handles a locale change while a draft is mounted.
 * Preserves both `rawInput` and `entryUnit` when `draft.isEditing` is true so
 * mid-entry edits are never silently converted.
 */
export function syncDraftLocaleWithoutSilentConversion(
  draft: MeasurementEntryDraft,
  nextLocaleTag: string,
): MeasurementEntryDraft {
  if (draft.isEditing && draft.rawInput.trim().length > 0) {
    return {
      ...draft,
      localeTag: nextLocaleTag,
    };
  }
  return {
    ...draft,
    localeTag: nextLocaleTag,
    entryUnit: draft.originalStored
      ? draft.originalStored.enteredUnit
      : getDefaultUnitForLocale(draft.category, nextLocaleTag),
  };
}

/**
 * Explicitly changes the draft unit. By default (`convertValue: false`), keeps the
 * user's typed digits unchanged so switching from e.g. `lb` to `kg` after typing `12`
 * means "12 kg", not "5.44 kg", unless explicit conversion is requested.
 */
export function changeDraftUnit(
  draft: MeasurementEntryDraft,
  nextUnit: MeasurementUnit,
  options: { convertValue?: boolean } = {},
): MeasurementEntryDraft {
  if (!options.convertValue || !draft.rawInput.trim()) {
    return {
      ...draft,
      entryUnit: nextUnit,
    };
  }

  const parsed = parseLocaleNumber(draft.rawInput, draft.localeTag);
  if (parsed === null) {
    return {
      ...draft,
      entryUnit: nextUnit,
    };
  }

  const { canonicalValue } = toCanonicalValue(parsed, draft.entryUnit);
  const converted = fromCanonicalValue(canonicalValue, nextUnit);
  return {
    ...draft,
    entryUnit: nextUnit,
    rawInput: formatNumberForLocaleInput(converted, draft.localeTag),
  };
}

/**
 * Evaluates server-confirmed write permissions while preserving offline queueing.
 */
export function validateMeasurementEntryPermission(
  context?: EntryPermissionContext,
  now: number = Date.now(),
): EntryPermissionResult {
  if (!context) {
    return { allowed: true, status: 'confirmed' };
  }

  const staleWindow = context.staleAfterMs ?? DEFAULT_STALE_WINDOW_MS;

  if (context.isOffline) {
    if (context.offlineCachedWriteGrant || (context.serverConfirmed && context.canWrite)) {
      return {
        allowed: true,
        status: 'offline_queued',
      };
    }
    return {
      allowed: false,
      status: 'denied',
      errorMessage: 'Cannot record measurement while offline without write permission.',
    };
  }

  if (!context.serverConfirmed || !context.canWrite) {
    return {
      allowed: false,
      status: 'denied',
      errorMessage: 'You do not have server-confirmed permission to modify clinical measurements.',
    };
  }

  if (context.confirmedAt === null || now - context.confirmedAt > staleWindow) {
    return {
      allowed: false,
      status: 'stale',
      errorMessage: 'Permission confirmation is stale. Please refresh and retry saving.',
    };
  }

  return {
    allowed: true,
    status: 'confirmed',
  };
}

/**
 * Validates and commits a measurement draft into an unambiguous `StoredMeasurement`.
 */
export function commitMeasurementEntry(
  draft: MeasurementEntryDraft,
  options: {
    recordedAtIso?: string;
    now?: number;
    permissionContext?: EntryPermissionContext;
  } = {},
): CommitMeasurementResult {
  const now = options.now ?? Date.now();
  const perm = validateMeasurementEntryPermission(options.permissionContext, now);

  if (!perm.allowed) {
    return {
      ok: false,
      status: perm.status === 'stale' ? 'stale_data' : 'permission_denied',
      errorMessage: perm.errorMessage,
      retryable: perm.status === 'stale',
    };
  }

  const parsedValue = parseLocaleNumber(draft.rawInput, draft.localeTag);
  if (parsedValue === null) {
    return {
      ok: false,
      status: 'validation_error',
      errorMessage: 'Enter a valid numeric measurement for the active locale.',
      retryable: true,
    };
  }

  const { canonicalValue, canonicalUnit } = toCanonicalValue(parsedValue, draft.entryUnit);
  const bounds = CANONICAL_BOUNDS[draft.category];

  if (canonicalValue < bounds.min || canonicalValue > bounds.max) {
    return {
      ok: false,
      status: 'validation_error',
      errorMessage: `Value is outside the valid clinical range (${bounds.min}–${bounds.max} ${bounds.canonicalUnit}).`,
      retryable: true,
    };
  }

  const recordedAtIso = options.recordedAtIso ?? new Date(now).toISOString();
  if (Number.isNaN(new Date(recordedAtIso).getTime())) {
    return {
      ok: false,
      status: 'validation_error',
      errorMessage: 'Recorded date/time is invalid.',
      retryable: true,
    };
  }

  const record: StoredMeasurement = {
    category: draft.category,
    canonicalValue,
    canonicalUnit,
    enteredValue: parsedValue,
    enteredUnit: draft.entryUnit,
    recordedAtIso,
    pendingOfflineSync: perm.status === 'offline_queued' ? true : undefined,
  };

  return {
    ok: true,
    record,
    status: perm.status === 'offline_queued' ? 'queued_offline' : 'committed',
    retryable: false,
  };
}

/**
 * Formats a stored measurement for display, showing the localized value alongside
 * the unambiguous stored unit (and original entered unit if different).
 */
export function formatStoredMeasurementDisplay(
  record: StoredMeasurement,
  localeTag: string = 'en-US',
  options: { preferEnteredUnit?: boolean } = {},
): string {
  const displayUnit = options.preferEnteredUnit
    ? record.enteredUnit
    : getDefaultUnitForLocale(record.category, localeTag);

  const numericValue =
    displayUnit === record.enteredUnit
      ? record.enteredValue
      : fromCanonicalValue(record.canonicalValue, displayUnit);

  const formattedNum = new Intl.NumberFormat(localeTag, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(numericValue);

  const unitSymbol = DISPLAY_UNIT_SYMBOLS[displayUnit];
  return `${formattedNum} ${unitSymbol}`;
}

/**
 * Parses a localized date entry string (`YYYY-MM-DD`, `MM/DD/YYYY` for `en-US`,
 * or `DD/MM/YYYY` for `es-ES`, `ar-SA`, etc.) into an unambiguous `YYYY-MM-DD` date.
 */
export function parseLocalizedDateInput(
  rawDate: string,
  localeTag: string = 'en-US',
): ParsedLocalDateResult {
  if (typeof rawDate !== 'string') {
    return { valid: false, errorMessage: 'Date input is required.' };
  }
  const normalized = normalizeLocaleDigits(rawDate).trim();
  if (!normalized) {
    return { valid: false, errorMessage: 'Date input is required.' };
  }

  let year: number;
  let month: number;
  let day: number;

  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
  if (isoMatch) {
    year = Number(isoMatch[1]);
    month = Number(isoMatch[2]);
    day = Number(isoMatch[3]);
  } else {
    const slashMatch = /^(\d{1,2})[/. -](\d{1,2})[/. -](\d{4})$/.exec(normalized);
    if (!slashMatch) {
      return {
        valid: false,
        errorMessage: 'Use the expected locale date format.',
      };
    }
    const first = Number(slashMatch[1]);
    const second = Number(slashMatch[2]);
    year = Number(slashMatch[3]);

    const isMonthFirst = IMPERIAL_LOCALES.has(localeTag);
    month = isMonthFirst ? first : second;
    day = isMonthFirst ? second : first;
  }

  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return { valid: false, errorMessage: 'Date values are out of range.' };
  }

  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() + 1 !== month ||
    candidate.getUTCDate() !== day
  ) {
    return { valid: false, errorMessage: 'Calendar date does not exist.' };
  }

  const isoDate = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { valid: true, isoDate, year, month, day };
}

/**
 * Parses a localized 24-hour (`14:30`) or 12-hour (`2:30 PM`, `2:30 p.m.`) time input.
 */
export function parseLocalizedTimeInput(rawTime: string): ParsedLocalTimeResult {
  if (typeof rawTime !== 'string') {
    return { valid: false, errorMessage: 'Time input is required.' };
  }
  const normalized = normalizeLocaleDigits(rawTime).trim();
  if (!normalized) {
    return { valid: false, errorMessage: 'Time input is required.' };
  }

  const match = /^(\d{1,2}):(\d{2})(?:\s*([AaPp]\.?\s?[Mm]\.?))?$/.exec(normalized);
  if (!match) {
    return { valid: false, errorMessage: 'Invalid time format.' };
  }

  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const meridiemRaw = match[3]?.replace(/[^a-zA-Z]/g, '').toUpperCase();

  if (minutes < 0 || minutes > 59) {
    return { valid: false, errorMessage: 'Minutes must be between 00 and 59.' };
  }

  if (meridiemRaw) {
    if (hours < 1 || hours > 12) {
      return { valid: false, errorMessage: '12-hour time must use hours between 1 and 12.' };
    }
    if (meridiemRaw === 'PM' && hours !== 12) {
      hours += 12;
    } else if (meridiemRaw === 'AM' && hours === 12) {
      hours = 0;
    }
  } else if (hours < 0 || hours > 23) {
    return { valid: false, errorMessage: '24-hour time must use hours between 00 and 23.' };
  }

  const isoTime = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  return { valid: true, isoTime, hours24: hours, minutes };
}

/**
 * Builds a privacy-safe accessibility label for a measurement entry control so
 * VoiceOver / TalkBack announces the field, current value, and full unit name.
 */
export function buildAccessibleMeasurementEntryLabel(options: {
  fieldLabel: string;
  draft: MeasurementEntryDraft;
  contextNote?: string;
}): string {
  const safeField = redactMeasurementContext(options.fieldLabel);
  const spokenUnit = SPOKEN_UNIT_NAMES[options.draft.entryUnit];
  const valuePart = options.draft.rawInput.trim()
    ? `${ redactMeasurementContext(options.draft.rawInput) } ${spokenUnit}`
    : `empty, unit ${spokenUnit}`;
  const notePart = options.contextNote
    ? `, ${redactMeasurementContext(options.contextNote)}`
    : '';
  return `${safeField}: ${valuePart}${notePart}`;
}
