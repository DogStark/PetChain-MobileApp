jest.mock('react-native', () => ({
  I18nManager: {
    isRTL: false,
    allowRTL: jest.fn(),
    forceRTL: jest.fn(),
  },
}));

import { I18nManager } from 'react-native';

import {
  LRI,
  LRM,
  PDI,
  applyLocaleDirection,
  backChevron,
  chartAxisOrder,
  directionForLanguage,
  directionalIconTransform,
  directionalSign,
  directionalValue,
  formFieldAlignment,
  formatMixedDirectionIdentifier,
  formatMixedDirectionMedicalString,
  forwardChevron,
  isolateLtrToken,
  physicalEdge,
  resolveRtlFlowState,
  rowDirection,
  shouldMirrorIcon,
  textAlign,
} from '../rtl';

const setRTL = (v: boolean) => ((I18nManager as unknown as { isRTL: boolean }).isRTL = v);

afterEach(() => {
  setRTL(false);
  jest.clearAllMocks();
});

describe('LTR (English) navigation + clinical forms', () => {
  it('lays rows and text out left-to-right', () => {
    expect(rowDirection()).toBe('row');
    expect(textAlign('start')).toBe('left');
    expect(textAlign('end')).toBe('right');
  });

  it('points the forward chevron right and back chevron left', () => {
    expect(forwardChevron()).toBe('chevron-right');
    expect(backChevron()).toBe('chevron-left');
  });

  it('maps logical edges and swipe sign for LTR', () => {
    expect(physicalEdge('start')).toBe('left');
    expect(physicalEdge('end')).toBe('right');
    expect(directionalSign()).toBe(1);
  });
});

describe('RTL (Arabic) navigation + clinical forms', () => {
  beforeEach(() => setRTL(true));

  it('mirrors row and text alignment', () => {
    expect(rowDirection()).toBe('row-reverse');
    expect(textAlign('start')).toBe('right');
    expect(textAlign('end')).toBe('left');
    expect(textAlign('center')).toBe('center');
  });

  it('mirrors navigation chevrons so "forward" still reads as forward', () => {
    expect(forwardChevron()).toBe('chevron-left');
    expect(backChevron()).toBe('chevron-right');
  });

  it('mirrors logical edges, gesture sign and reverse rows', () => {
    expect(physicalEdge('start')).toBe('right');
    expect(physicalEdge('end')).toBe('left');
    expect(directionalSign()).toBe(-1);
    expect(rowDirection(true)).toBe('row'); // reverse of RTL is LTR row
  });

  it('still returns the explicitly-requested value from directionalValue', () => {
    expect(directionalValue('a', 'b')).toBe('b');
  });
});

describe('directionForLanguage & applyLocaleDirection', () => {
  it('resolves per-locale direction including regional tags without touching global state', () => {
    expect(directionForLanguage('en')).toBe('ltr');
    expect(directionForLanguage('es-ES')).toBe('ltr');
    expect(directionForLanguage('ar')).toBe('rtl');
    expect(directionForLanguage('ar-SA')).toBe('rtl');
    expect(directionForLanguage('')).toBe('ltr');
  });

  it('synchronizes I18nManager when switching between LTR and RTL locales', () => {
    const toArabic = applyLocaleDirection('ar');
    expect(toArabic).toEqual({ direction: 'rtl', isRTL: true, changed: true });
    expect(I18nManager.allowRTL).toHaveBeenCalledWith(true);
    expect(I18nManager.forceRTL).toHaveBeenCalledWith(true);

    const stayArabic = applyLocaleDirection('ar-EG');
    expect(stayArabic.changed).toBe(false);

    const toEnglish = applyLocaleDirection('en');
    expect(toEnglish).toEqual({ direction: 'ltr', isRTL: false, changed: true });
  });
});

describe('Icons, charts, and clinical form field alignment (#1196)', () => {
  it('mirrors only directional icons in RTL and preserves universal medical/status icons', () => {
    expect(shouldMirrorIcon('chevron-right')).toBe(true);
    expect(shouldMirrorIcon('arrow-back')).toBe(true);
    expect(shouldMirrorIcon('check-circle')).toBe(false);
    expect(shouldMirrorIcon('alert-triangle')).toBe(false);
    expect(shouldMirrorIcon('')).toBe(false);

    expect(directionalIconTransform('chevron-right', true)).toEqual({
      transform: [{ scaleX: -1 }],
    });
    expect(directionalIconTransform('check-circle', true)).toEqual({
      transform: [{ scaleX: 1 }],
    });
    expect(directionalIconTransform('chevron-right', false)).toEqual({
      transform: [{ scaleX: 1 }],
    });
  });

  it('reverses chart series order in RTL without mutating the source array', () => {
    const series = ['2026-05-01', '2026-06-01', '2026-07-01'];
    expect(chartAxisOrder(series, false)).toEqual(['2026-05-01', '2026-06-01', '2026-07-01']);
    expect(chartAxisOrder(series, true)).toEqual(['2026-07-01', '2026-06-01', '2026-05-01']);
    expect(series).toEqual(['2026-05-01', '2026-06-01', '2026-07-01']);
    expect(chartAxisOrder([], true)).toEqual([]);
  });

  it('keeps identifiers, dosages, and numbers in LTR writingDirection even on RTL screens', () => {
    expect(formFieldAlignment('identifier', true)).toEqual({
      textAlign: 'right',
      writingDirection: 'ltr',
    });
    expect(formFieldAlignment('dosage', true)).toEqual({
      textAlign: 'right',
      writingDirection: 'ltr',
    });
    expect(formFieldAlignment('medical-note', true)).toEqual({
      textAlign: 'right',
      writingDirection: 'rtl',
    });
    expect(formFieldAlignment('medical-note', false)).toEqual({
      textAlign: 'left',
      writingDirection: 'ltr',
    });
  });
});

describe('Mixed-direction medical and identifier strings (#1196)', () => {
  it('wraps LTR tokens in Unicode isolates idempotently', () => {
    const isolated = isolateLtrToken('5 mg/kg');
    expect(isolated).toBe(`${LRI}${LRM}5 mg/kg${PDI}`);
    expect(isolateLtrToken(isolated)).toBe(isolated);
    expect(isolateLtrToken('   ')).toBe('');
  });

  it('formats pet/blockchain identifiers with LTR isolation and optional privacy masking', () => {
    expect(formatMixedDirectionIdentifier('PET-2026-0042')).toBe(
      `${LRI}${LRM}PET-2026-0042${PDI}`,
    );
    expect(
      formatMixedDirectionIdentifier('GBDEVU63Y6NTHJQQZIKVTC23NWLQVP3WJ2RI2OTSJTNYOIGICST6DUXR', {
        maskSensitive: true,
        visiblePrefix: 4,
        visibleSuffix: 4,
      }),
    ).toBe(`${LRI}${LRM}GBDE••••DUXR${PDI}`);
    expect(formatMixedDirectionIdentifier('SHORT', { maskSensitive: true })).toBe(
      `${LRI}${LRM}••••${PDI}`,
    );
    expect(formatMixedDirectionIdentifier('')).toBe('');
  });

  it('isolates embedded dosages, drug names, and units inside Arabic clinical instructions', () => {
    const arabicNote = 'إعطاء Amoxicillin بجرعة 250 mg/5 mL مرتين يومياً (BID) لمدة 7 أيام';
    const formatted = formatMixedDirectionMedicalString(arabicNote, true);

    expect(formatted).toContain(`${LRI}${LRM}Amoxicillin${PDI}`);
    expect(formatted).toContain(`${LRI}${LRM}250 mg/5 mL${PDI}`);
    expect(formatted).toContain(`${LRI}${LRM}BID${PDI}`);
  });

  it('leaves plain English strings untouched when layout is LTR', () => {
    const englishNote = 'Give Amoxicillin 250 mg/5 mL BID for 7 days';
    expect(formatMixedDirectionMedicalString(englishNote, false)).toBe(englishNote);
  });
});

describe('RTL flow state with server permissions and offline fallback (#1196)', () => {
  it('enforces server-confirmed permissions and falls back to cached direction when offline', () => {
    expect(
      resolveRtlFlowState({
        lang: 'ar',
        hasServerPermission: false,
      }),
    ).toEqual({
      direction: 'rtl',
      isRTL: true,
      allowed: false,
      usingCachedDirection: false,
    });

    expect(
      resolveRtlFlowState({
        lang: '',
        hasServerPermission: true,
        isOffline: true,
        cachedDirection: 'rtl',
      }),
    ).toEqual({
      direction: 'rtl',
      isRTL: true,
      allowed: true,
      usingCachedDirection: true,
    });
  });
});
