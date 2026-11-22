import { createGeocoder, setGeocoder } from '../geocodingService';
import {
  _resetVetProfiles,
  backfillVetCoordinates,
  createVetProfile,
  getVetProfile,
  updateVetProfile,
} from '../vetDirectoryService';

describe('vet clinic geocoding (#1396)', () => {
  const geocode = jest.fn();

  beforeEach(() => {
    _resetVetProfiles();
    geocode.mockReset();
    geocode.mockImplementation(async (address: string) =>
      address.includes('Lagos') ? { lat: 6.5244, lng: 3.3792 } : { lat: 51.5072, lng: -0.1276 },
    );
    setGeocoder(geocode);
  });

  it('geocodes the address when a clinic is created', async () => {
    const profile = await createVetProfile('vet-1', 'vet@test.com', {
      specialty: 'General',
      address: '1 Clinic Road, London',
    });

    expect(geocode).toHaveBeenCalledWith('1 Clinic Road, London');
    expect(profile.lat).toBe(51.5072);
    expect(profile.lng).toBe(-0.1276);
  });

  it('re-geocodes when the address changes', async () => {
    const profile = await createVetProfile('vet-1', 'vet@test.com', {
      specialty: 'General',
      address: '1 Clinic Road, London',
    });
    geocode.mockClear();

    const updated = await updateVetProfile(profile.id, { address: '5 Marina, Lagos' });

    expect(geocode).toHaveBeenCalledTimes(1);
    expect(geocode).toHaveBeenCalledWith('5 Marina, Lagos');
    expect(updated?.lat).toBe(6.5244);
    expect(updated?.lng).toBe(3.3792);
  });

  it('does not geocode when the address is unchanged', async () => {
    const profile = await createVetProfile('vet-1', 'vet@test.com', {
      specialty: 'General',
      address: '1 Clinic Road, London',
    });
    geocode.mockClear();

    await updateVetProfile(profile.id, { phone: '+44 20 0000 0000' });
    await updateVetProfile(profile.id, { address: '1 Clinic Road, London' });

    expect(geocode).not.toHaveBeenCalled();
  });

  it('clears coordinates when a new address cannot be geocoded', async () => {
    const profile = await createVetProfile('vet-1', 'vet@test.com', {
      specialty: 'General',
      address: '1 Clinic Road, London',
    });
    geocode.mockResolvedValueOnce(null);

    const updated = await updateVetProfile(profile.id, { address: 'Unknown place' });

    expect(updated?.lat).toBeNull();
    expect(updated?.lng).toBeNull();
  });

  it('backfills clinics that have an address but no coordinates', async () => {
    geocode.mockResolvedValueOnce(null);
    const profile = await createVetProfile('vet-1', 'vet@test.com', {
      specialty: 'General',
      address: '5 Marina, Lagos',
    });
    expect(profile.lat).toBeNull();

    const updated = await backfillVetCoordinates();

    expect(updated).toBe(1);
    expect(getVetProfile(profile.id)?.lat).toBe(6.5244);
  });
});

describe('createGeocoder', () => {
  it('parses a Nominatim response', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ lat: '6.5244', lon: '3.3792' }],
    });
    const geocoder = createGeocoder({}, fetchImpl);

    await expect(geocoder('5 Marina, Lagos')).resolves.toEqual({ lat: 6.5244, lng: 3.3792 });
    expect(fetchImpl.mock.calls[0][0]).toContain('nominatim.openstreetmap.org');
  });

  it('uses Google when an API key is configured', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [{ geometry: { location: { lat: 1.5, lng: 2.5 } } }] }),
    });
    const geocoder = createGeocoder({ GOOGLE_GEOCODING_API_KEY: 'test-key' }, fetchImpl);

    await expect(geocoder('Somewhere')).resolves.toEqual({ lat: 1.5, lng: 2.5 });
    expect(fetchImpl.mock.calls[0][0]).toContain('maps.googleapis.com');
  });

  it('returns null for an empty address without calling the provider', async () => {
    const fetchImpl = jest.fn();
    const geocoder = createGeocoder({}, fetchImpl);

    await expect(geocoder('   ')).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
