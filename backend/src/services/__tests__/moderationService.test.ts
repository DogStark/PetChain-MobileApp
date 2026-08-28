import moderationService from '../moderationService';

describe('moderationService', () => {
  it('flags harmful advice as spam', () => {
    expect(moderationService.isLikelySpam('This medicine will poison your pet')).toBe(true);
  });

  it('flags spammy promotional content', () => {
    expect(moderationService.isLikelySpam('Click here for a free gift!')).toBe(true);
  });

  it('allows normal health questions', () => {
    expect(moderationService.isLikelySpam('How often should I bathe my dog?')).toBe(false);
  });

  it('flags too short content as spam', () => {
    expect(moderationService.isLikelySpam('Hi')).toBe(true);
  });
});
