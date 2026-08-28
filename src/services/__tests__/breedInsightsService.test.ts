import { generateCareRecommendations, parseBreedBreakdown } from '../breedInsightsService';

describe('breedInsightsService helpers', () => {
  it('parses mixed breed strings with percentages', () => {
    const breakdown = parseBreedBreakdown('Labrador Retriever (70%) + Poodle (30%)');
    expect(breakdown).toEqual([
      { name: 'Labrador Retriever', percentage: 70 },
      { name: 'Poodle', percentage: 30 },
    ]);
  });

  it('defaults equal percentages when none are specified', () => {
    const breakdown = parseBreedBreakdown('Golden Retriever, German Shepherd');
    expect(breakdown).toEqual([
      { name: 'Golden Retriever', percentage: 50 },
      { name: 'German Shepherd', percentage: 50 },
    ]);
  });

  it('generates senior care recommendations for older pets', () => {
    const recommendations = generateCareRecommendations({
      species: 'dog',
      breedName: 'Golden Retriever',
      ageYears: 11,
      weightKg: 35,
      healthRisks: ['hip dysplasia', 'obesity'],
    });

    expect(recommendations).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Senior pets'),
        expect.stringContaining('joint health'),
        expect.stringContaining('weight'),
      ]),
    );
  });
});
