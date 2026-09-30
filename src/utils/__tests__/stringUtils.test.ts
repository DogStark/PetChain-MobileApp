import {
  capitalise,
  toTitleCase,
  truncate,
  maskEmail,
  maskPhone,
  slugify,
  stripHtml,
  initials,
  padStart,
  padEnd,
  toCamelCase,
} from '../stringUtils';

// ─── capitalise ───────────────────────────────────────────────────────────────

describe('capitalise', () => {
  it.each([
    ['hello world', 'Hello world'],
    ['HELLO', 'HELLO'],
    ['a', 'A'],
    ['already Capitalised', 'Already Capitalised'],
  ])('capitalise(%s) = %s', (input, expected) => {
    expect(capitalise(input)).toBe(expected);
  });

  it.each(['', null as unknown as string, undefined as unknown as string])(
    'returns empty string for falsy: %s',
    (v) => {
      expect(capitalise(v)).toBe('');
    },
  );
});

// ─── toTitleCase ──────────────────────────────────────────────────────────────

describe('toTitleCase', () => {
  it.each([
    ['the quick brown fox', 'The Quick Brown Fox'],
    ['hello world', 'Hello World'],
    ['UPPER CASE', 'Upper Case'],
    ['single', 'Single'],
    ['', ''],
  ])('toTitleCase(%s) = %s', (input, expected) => {
    expect(toTitleCase(input)).toBe(expected);
  });
});

// ─── truncate ─────────────────────────────────────────────────────────────────

describe('truncate', () => {
  it('does not truncate strings within the limit', () => {
    expect(truncate('Hello', 10)).toBe('Hello');
  });

  it('truncates and appends default ellipsis (…)', () => {
    expect(truncate('Hello, world!', 8)).toBe('Hello, …');
  });

  it('uses a custom ellipsis', () => {
    expect(truncate('Hello, world!', 9, '...')).toBe('Hello,...');
  });

  it('handles maxLen ≤ 0', () => {
    expect(truncate('Hello', 0)).toBe('');
    expect(truncate('Hello', -5)).toBe('');
  });

  it('returns empty string for empty input', () => {
    expect(truncate('', 10)).toBe('');
  });

  it('handles maxLen shorter than the ellipsis itself', () => {
    const result = truncate('Hello, world!', 1, '...');
    expect(result.length).toBeLessThanOrEqual(1);
  });

  it('truncates exactly at the boundary', () => {
    const str = 'abcde';
    expect(truncate(str, 5)).toBe('abcde'); // no truncation at exact length
    expect(truncate(str, 4)).toBe('abc…'); // one character over
  });
});

// ─── maskEmail ────────────────────────────────────────────────────────────────

describe('maskEmail', () => {
  it.each([
    ['alice@example.com', 'a****@example.com'],
    ['ab@example.com', 'a*@example.com'],
    ['user+tag@host.org', 'u*******@host.org'],
  ])('maskEmail(%s) = %s', (input, expected) => {
    expect(maskEmail(input)).toBe(expected);
  });

  it('returns unchanged string if no @ is found', () => {
    expect(maskEmail('notanemail')).toBe('notanemail');
  });

  it('returns unchanged when local part is 1 character', () => {
    expect(maskEmail('a@example.com')).toBe('a@example.com');
  });

  it('returns empty string for empty input', () => {
    expect(maskEmail('')).toBe('');
  });
});

// ─── maskPhone ────────────────────────────────────────────────────────────────

describe('maskPhone', () => {
  it('shows only last 4 digits', () => {
    // '+1 (555) 123-4567' → digits: '15551234567' (11 digits) → 7 stars + last 4
    expect(maskPhone('+1 (555) 123-4567')).toBe('*******4567');
  });

  it('strips non-digit characters before masking', () => {
    expect(maskPhone('07700 900 123')).toBe('*******0123');
  });

  it('returns the number unchanged when ≤ 4 digits', () => {
    expect(maskPhone('1234')).toBe('1234');
    expect(maskPhone('123')).toBe('123');
  });

  it('returns empty string for empty input', () => {
    expect(maskPhone('')).toBe('');
  });
});

// ─── slugify ──────────────────────────────────────────────────────────────────

describe('slugify', () => {
  it.each([
    ['Hello World!', 'hello-world'],
    ['Café au lait', 'cafe-au-lait'],
    ['  multiple   spaces ', 'multiple-spaces'],
    ['PetChain -- App', 'petchain-app'],
    ['Already-a-slug', 'already-a-slug'],
    ['Ñoño', 'nono'],
    ['', ''],
  ])('slugify(%s) = %s', (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  it('does not start or end with a hyphen', () => {
    const result = slugify('  !test! ');
    expect(result).not.toMatch(/^-|-$/);
  });
});

// ─── stripHtml ────────────────────────────────────────────────────────────────

describe('stripHtml', () => {
  it.each([
    ['<p>Hello <strong>world</strong>!</p>', 'Hello world!'],
    ['No tags here', 'No tags here'],
    ['<br />', ''],
    ['', ''],
  ])('stripHtml(%s) = %s', (input, expected) => {
    expect(stripHtml(input)).toBe(expected);
  });
});

// ─── initials ─────────────────────────────────────────────────────────────────

describe('initials', () => {
  it.each([
    ['John Doe', 2, 'JD'],
    ['Alice', 2, 'A'],
    ['Mary Jane Watson', 2, 'MJ'],
    ['Mary Jane Watson', 3, 'MJW'],
    ['', 2, ''],
  ])('initials(%s, %d) = %s', (name, max, expected) => {
    expect(initials(name, max)).toBe(expected);
  });

  it('defaults to 2 initials', () => {
    expect(initials('John Michael Doe')).toBe('JM');
  });
});

// ─── padStart / padEnd ────────────────────────────────────────────────────────

describe('padStart', () => {
  it('left-pads with zeros', () => {
    expect(padStart('5', 2, '0')).toBe('05');
  });

  it('does not pad when string is already long enough', () => {
    expect(padStart('hello', 3)).toBe('hello');
  });
});

describe('padEnd', () => {
  it('right-pads with dots', () => {
    expect(padEnd('hi', 5, '.')).toBe('hi...');
  });
});

// ─── toCamelCase ─────────────────────────────────────────────────────────────

describe('toCamelCase', () => {
  it.each([
    ['hello-world', 'helloWorld'],
    ['foo_bar_baz', 'fooBarBaz'],
    ['already', 'already'],
    ['', ''],
  ])('toCamelCase(%s) = %s', (input, expected) => {
    expect(toCamelCase(input)).toBe(expected);
  });
});

// ─── Purity checks ────────────────────────────────────────────────────────────

describe('purity', () => {
  it('capitalise does not mutate input', () => {
    const input = 'hello';
    capitalise(input);
    expect(input).toBe('hello');
  });

  it('truncate does not mutate input', () => {
    const input = 'Hello, world!';
    truncate(input, 5);
    expect(input).toBe('Hello, world!');
  });

  it('slugify does not mutate input', () => {
    const input = 'Hello World';
    slugify(input);
    expect(input).toBe('Hello World');
  });
});
