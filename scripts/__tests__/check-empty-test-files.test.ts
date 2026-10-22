import { countTestCases, hasSuppressComment } from '../../scripts/check-empty-test-files';

describe('check-empty-test-files helpers', () => {
  it('counts it/test/describe blocks', () => {
    const content = `
      describe('suite', () => {
        it('works', () => {});
        test('also works', () => {});
      });
    `;

    expect(countTestCases(content)).toBe(3);
  });

  it('detects TODO issue suppress comments', () => {
    expect(hasSuppressComment('// TODO: #602')).toBe(true);
    expect(hasSuppressComment('// todo later')).toBe(false);
  });

  it('treats files without test blocks as insufficient', () => {
    expect(countTestCases('export const value = 1;')).toBe(0);
  });
});
