/**
 * Minimal, dependency-free runtime schema validation for mobile API responses.
 *
 * TypeScript types are erased at runtime, so untrusted JSON from the network can
 * still contain nulls, wrong types or malformed nested data that crash a screen
 * on first render. These schemas parse a response into a known shape and return
 * a typed failure instead of throwing deep inside a component.
 */

export interface ValidationIssue {
  path: string;
  message: string;
}

export type ParseResult<T> =
  | { success: true; data: T }
  | { success: false; issues: ValidationIssue[] };

export abstract class Schema<T> {
  abstract _parse(value: unknown, path: string): ParseResult<T>;

  parse(value: unknown): ParseResult<T> {
    return this._parse(value, '$');
  }

  optional(): Schema<T | undefined> {
    return new OptionalSchema(this);
  }
}

function fail(path: string, message: string): ParseResult<never> {
  return { success: false, issues: [{ path, message }] };
}

class StringSchema extends Schema<string> {
  _parse(value: unknown, path: string): ParseResult<string> {
    return typeof value === 'string'
      ? { success: true, data: value }
      : fail(path, `expected string, got ${value === null ? 'null' : typeof value}`);
  }
}

class NumberSchema extends Schema<number> {
  _parse(value: unknown, path: string): ParseResult<number> {
    return typeof value === 'number' && Number.isFinite(value)
      ? { success: true, data: value }
      : fail(path, `expected finite number, got ${value === null ? 'null' : typeof value}`);
  }
}

class BooleanSchema extends Schema<boolean> {
  _parse(value: unknown, path: string): ParseResult<boolean> {
    return typeof value === 'boolean'
      ? { success: true, data: value }
      : fail(path, `expected boolean, got ${value === null ? 'null' : typeof value}`);
  }
}

class LiteralSchema<L extends string | number | boolean> extends Schema<L> {
  constructor(private readonly literal: L) {
    super();
  }
  _parse(value: unknown, path: string): ParseResult<L> {
    return value === this.literal
      ? { success: true, data: this.literal }
      : fail(path, `expected literal ${JSON.stringify(this.literal)}`);
  }
}

class OptionalSchema<T> extends Schema<T | undefined> {
  constructor(private readonly inner: Schema<T>) {
    super();
  }
  _parse(value: unknown, path: string): ParseResult<T | undefined> {
    if (value === undefined || value === null) return { success: true, data: undefined };
    return this.inner._parse(value, path);
  }
}

class ArraySchema<T> extends Schema<T[]> {
  constructor(private readonly element: Schema<T>) {
    super();
  }
  _parse(value: unknown, path: string): ParseResult<T[]> {
    if (!Array.isArray(value)) return fail(path, 'expected array');
    const out: T[] = [];
    const issues: ValidationIssue[] = [];
    value.forEach((item, index) => {
      const res = this.element._parse(item, `${path}[${index}]`);
      if (res.success) out.push(res.data);
      else issues.push(...res.issues);
    });
    return issues.length ? { success: false, issues } : { success: true, data: out };
  }
}

type ShapeOf<S extends Record<string, Schema<unknown>>> = {
  [K in keyof S]: S[K] extends Schema<infer U> ? U : never;
};

class ObjectSchema<S extends Record<string, Schema<unknown>>> extends Schema<ShapeOf<S>> {
  constructor(private readonly shape: S) {
    super();
  }
  _parse(value: unknown, path: string): ParseResult<ShapeOf<S>> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return fail(path, 'expected object');
    }
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    const issues: ValidationIssue[] = [];
    for (const key of Object.keys(this.shape)) {
      const res = this.shape[key]._parse(record[key], `${path}.${key}`);
      if (res.success) out[key] = res.data;
      else issues.push(...res.issues);
    }
    return issues.length
      ? { success: false, issues }
      : { success: true, data: out as ShapeOf<S> };
  }
}

export const v = {
  string: () => new StringSchema(),
  number: () => new NumberSchema(),
  boolean: () => new BooleanSchema(),
  literal: <L extends string | number | boolean>(value: L) => new LiteralSchema(value),
  array: <T>(element: Schema<T>) => new ArraySchema(element),
  object: <S extends Record<string, Schema<unknown>>>(shape: S) => new ObjectSchema(shape),
};

export class ResponseValidationError extends Error {
  constructor(
    public readonly issues: ValidationIssue[],
    context: string,
  ) {
    super(
      `Response validation failed for ${context}: ${issues
        .map((i) => `${i.path} ${i.message}`)
        .join('; ')}`,
    );
    this.name = 'ResponseValidationError';
  }
}

/** Parse untrusted data, throwing a single typed error on failure. */
export function parseResponse<T>(schema: Schema<T>, data: unknown, context: string): T {
  const result = schema.parse(data);
  if (result.success) return result.data;
  throw new ResponseValidationError(result.issues, context);
}
