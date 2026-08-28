import { findNearbyMatches, haversineDistanceKm, isFoundReportExpired } from '../matchingService';

describe('matchingService', () => {
  const baseReport = {
    id: 'r-lost-1',
    type: 'lost' as const,
    title: 'Lost dog',
    description: 'Missing near the park',
    species: 'Dog',
    breed: 'Labrador',
    photoUrl: 'file:///images/lab1.jpg',
    location: { latitude: 40.7128, longitude: -74.006 },
    ownerId: 'owner-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const foundMatch = {
    id: 'r-found-1',
    type: 'found' as const,
    title: 'Found dog',
    description: 'Near the same park',
    species: 'Dog',
    breed: 'Labrador',
    photoUrl: 'https://example.com/photos/lab1.jpg',
    location: { latitude: 40.7132, longitude: -74.0055 },
    ownerId: 'owner-2',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString(),
  };

  const foundExpired = {
    ...foundMatch,
    id: 'r-found-2',
    createdAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(),
    expiresAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
  };

  it('calculates straight line distances with haversine', () => {
    const distance = haversineDistanceKm(
      { latitude: 40.7128, longitude: -74.006 },
      { latitude: 40.7132, longitude: -74.0055 },
    );
    expect(distance).toBeGreaterThan(0);
    expect(distance).toBeLessThan(0.2);
  });

  it('matches lost and found reports by species, breed, and location', async () => {
    const matches = await findNearbyMatches(baseReport, [foundMatch], 5);
    expect(matches).toHaveLength(1);
    expect(matches[0].id).toBe(foundMatch.id);
  });

  it('does not match expired found reports', async () => {
    const matches = await findNearbyMatches(baseReport, [foundExpired], 5);
    expect(matches).toHaveLength(0);
    expect(isFoundReportExpired(foundExpired)).toBe(true);
  });

  it('matches reports when photo filenames match across different URLs', async () => {
    const foundByPhoto = {
      ...foundMatch,
      id: 'r-found-3',
      location: { latitude: 41.0, longitude: -74.0 },
      photoUrl: 'https://cdn.example.com/images/lab1.jpg',
    };
    const matches = await findNearbyMatches(baseReport, [foundByPhoto], 1);
    expect(matches).toHaveLength(1);
    expect(matches[0].photoUrl).toBe(foundByPhoto.photoUrl);
  });
});
