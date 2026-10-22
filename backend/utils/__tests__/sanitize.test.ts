import type { NextFunction, Request, Response } from 'express';

import { sanitizeInputs } from '../../middleware/sanitize';
import {
  stripXss,
  detectSqlInjection,
  truncate,
  sanitizeValue,
  sanitizeObject,
  SanitizationError,
  MAX_INPUT_LENGTH,
} from '../sanitize';

describe('stripXss', () => {
  it('removes HTML tags leaving text content', () => {
    expect(stripXss('<script>alert(1)</script>hello')).toBe('alert(1)hello');
    expect(stripXss('<b>bold</b>')).toBe('bold');
  });

  it('removes self-closing tags entirely', () => {
    expect(stripXss('<img src=x onerror=alert(1)>')).toBe('');
    expect(stripXss('<br/>')).toBe('');
  });

  it('removes javascript: and data: URI patterns', () => {
    expect(stripXss('javascript:alert(1)')).not.toContain('javascript:');
    expect(stripXss('data:text/html,<h1>x</h1>')).not.toContain('data:');
  });

  it('removes inline event handlers', () => {
    expect(stripXss('onclick=evil()')).not.toContain('onclick=');
    expect(stripXss('onmouseover=bad()')).not.toContain('onmouseover=');
  });

  it('passes clean text through unchanged', () => {
    expect(stripXss('Hello, World!')).toBe('Hello, World!');
    expect(stripXss('pet name: Buddy')).toBe('pet name: Buddy');
  });
});

describe('detectSqlInjection', () => {
  it('detects SELECT statements', () => {
    expect(detectSqlInjection("' OR SELECT * FROM users--")).toBe(true);
    expect(detectSqlInjection('SELECT password FROM users')).toBe(true);
  });

  it('detects DROP and DELETE', () => {
    expect(detectSqlInjection('DROP TABLE pets')).toBe(true);
    expect(detectSqlInjection('DELETE FROM users')).toBe(true);
  });

  it('detects comment sequences', () => {
    expect(detectSqlInjection("admin'--")).toBe(true);
    expect(detectSqlInjection('/* comment */')).toBe(true);
  });

  it('detects UNION injection', () => {
    expect(detectSqlInjection("' UNION SELECT null,null--")).toBe(true);
  });

  it('returns false for clean input', () => {
    expect(detectSqlInjection('Buddy the dog')).toBe(false);
    expect(detectSqlInjection('john@example.com')).toBe(false);
    expect(detectSqlInjection('2024-01-01')).toBe(false);
  });
});

describe('truncate', () => {
  it('truncates strings exceeding maxLength', () => {
    expect(truncate('abcdef', 3)).toBe('abc');
  });

  it('leaves strings within limit unchanged', () => {
    expect(truncate('abc', 10)).toBe('abc');
    expect(truncate('abc', 3)).toBe('abc');
  });

  it('uses MAX_INPUT_LENGTH as default', () => {
    const long = 'x'.repeat(MAX_INPUT_LENGTH + 1);
    expect(truncate(long)).toHaveLength(MAX_INPUT_LENGTH);
  });
});

describe('sanitizeValue', () => {
  it('strips XSS from clean input', () => {
    expect(sanitizeValue('<b>hello</b>')).toBe('hello');
  });

  it('truncates long input', () => {
    const long = 'a'.repeat(MAX_INPUT_LENGTH + 100);
    expect(sanitizeValue(long)).toHaveLength(MAX_INPUT_LENGTH);
  });

  it('throws SanitizationError on SQL injection', () => {
    expect(() => sanitizeValue("' OR 1=1--")).toThrow(SanitizationError);
    expect(() => sanitizeValue('SELECT * FROM users')).toThrow(SanitizationError);
  });

  it('passes clean input through', () => {
    expect(sanitizeValue('Buddy')).toBe('Buddy');
    expect(sanitizeValue('john@example.com')).toBe('john@example.com');
  });
});

describe('sanitizeObject', () => {
  it('sanitizes string values in a flat object', () => {
    const result = sanitizeObject({ name: '<b>Buddy</b>', age: 3 }) as any;
    expect(result.name).toBe('Buddy');
    expect(result.age).toBe(3);
  });

  it('recursively sanitizes nested objects', () => {
    const result = sanitizeObject({ a: { b: '<script>x</script>' } }) as any;
    expect(result.a.b).toBe('x'); // tags stripped, text content preserved
  });

  it('sanitizes arrays of strings', () => {
    const result = sanitizeObject(['<b>a</b>', 'clean']) as string[];
    expect(result[0]).toBe('a');
    expect(result[1]).toBe('clean');
  });

  it('throws SanitizationError when any value contains SQL injection', () => {
    expect(() => sanitizeObject({ q: 'DROP TABLE users' })).toThrow(SanitizationError);
  });

  it('passes non-string primitives through unchanged', () => {
    const result = sanitizeObject({ n: 42, b: true, nil: null }) as any;
    expect(result.n).toBe(42);
    expect(result.b).toBe(true);
    expect(result.nil).toBeNull();
  });
});

// ─── Middleware ───────────────────────────────────────────────────────────────

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    body: {},
    query: {},
    params: {},
    ...overrides,
  } as unknown as Request;
}

function makeRes(): { status: jest.Mock; json: jest.Mock; statusCode: number } {
  const res = { status: jest.fn(), json: jest.fn(), statusCode: 200 } as any;
  res.status.mockReturnValue(res);
  return res;
}

describe('sanitizeInputs middleware', () => {
  it('sanitizes req.body strings', () => {
    const req = makeReq({ body: { name: '<script>evil</script>' } });
    const res = makeRes();
    const next = jest.fn() as NextFunction;

    sanitizeInputs(req as Request, res as unknown as Response, next);

    expect(next).toHaveBeenCalled();
    expect(req.body.name).toBe('evil'); // tags stripped, text content preserved
  });

  it('sanitizes req.query strings', () => {
    const req = makeReq({ query: { search: '<img src=x>' } as any });
    const res = makeRes();
    const next = jest.fn() as NextFunction;

    sanitizeInputs(req as Request, res as unknown as Response, next);

    expect(next).toHaveBeenCalled();
    expect((req.query as any).search).toBe('');
  });

  it('sanitizes req.params strings', () => {
    const req = makeReq({ params: { id: '<b>123</b>' } as any });
    const res = makeRes();
    const next = jest.fn() as NextFunction;

    sanitizeInputs(req as Request, res as unknown as Response, next);

    expect(next).toHaveBeenCalled();
    expect(req.params.id).toBe('123');
  });

  it('returns 400 when SQL injection is detected in body', () => {
    const req = makeReq({ body: { q: 'SELECT * FROM users' } });
    const res = makeRes();
    const next = jest.fn() as NextFunction;

    sanitizeInputs(req as Request, res as unknown as Response, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'INVALID_INPUT' }));
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next for clean input without modification', () => {
    const req = makeReq({ body: { name: 'Buddy', age: 3 } });
    const res = makeRes();
    const next = jest.fn() as NextFunction;

    sanitizeInputs(req as Request, res as unknown as Response, next);

    expect(next).toHaveBeenCalled();
    expect(req.body.name).toBe('Buddy');
    expect(req.body.age).toBe(3);
  });
});
