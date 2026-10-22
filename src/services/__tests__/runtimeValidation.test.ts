import {
  ResponseValidationError,
  parseResponse,
  v,
} from '../runtimeValidation';

const slot = v.object({
  date: v.string(),
  time: v.string(),
  durationMinutes: v.number(),
  confirmed: v.boolean().optional(),
});

const payload = v.object({
  data: v.object({
    slots: v.array(slot),
  }),
});

describe('runtimeValidation', () => {
  it('parses a well-formed nested payload', () => {
    const result = payload.parse({
      data: { slots: [{ date: '2026-01-01', time: '09:00', durationMinutes: 30 }] },
    });
    expect(result).toEqual({
      success: true,
      data: { data: { slots: [{ date: '2026-01-01', time: '09:00', durationMinutes: 30, confirmed: undefined }] } },
    });
  });

  it('reports typed issues for malformed nested data instead of throwing', () => {
    const result = payload.parse({
      data: { slots: [{ date: 42, time: '09:00', durationMinutes: 'thirty' }, null] },
    });
    expect(result.success).toBe(false);
    if (result.success) throw new Error('expected failure');
    const paths = result.issues.map((i) => i.path);
    expect(paths).toContain('$.data.slots[0].date');
    expect(paths).toContain('$.data.slots[0].durationMinutes');
    expect(paths).toContain('$.data.slots[1]');
  });

  it('treats null/undefined optionals as absent but still checks present ones', () => {
    expect(slot.parse({ date: 'd', time: 't', durationMinutes: 1, confirmed: null }).success).toBe(
      true,
    );
    const bad = slot.parse({ date: 'd', time: 't', durationMinutes: 1, confirmed: 'yes' });
    expect(bad.success).toBe(false);
  });

  it('rejects arrays where an object is expected and vice versa', () => {
    expect(payload.parse([]).success).toBe(false);
    expect(v.array(v.string()).parse('nope').success).toBe(false);
  });

  it('rejects NaN / Infinity as numbers', () => {
    expect(v.number().parse(NaN).success).toBe(false);
    expect(v.number().parse(Infinity).success).toBe(false);
  });

  it('parseResponse throws a single typed error carrying every issue', () => {
    expect.assertions(3);
    try {
      parseResponse(payload, { data: { slots: [{ date: 1, time: 2, durationMinutes: 3 }] } }, 'ctx');
    } catch (err) {
      expect(err).toBeInstanceOf(ResponseValidationError);
      expect((err as ResponseValidationError).issues.length).toBe(2);
      expect((err as Error).message).toContain('ctx');
    }
  });
});
