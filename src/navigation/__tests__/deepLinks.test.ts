import fc from 'fast-check';

import { parseDeepLink } from '../deepLinks';

describe('parseDeepLink', () => {
  it('accepts only documented PetChain routes', () => {
    expect(parseDeepLink('https://petchain.app/pets/pet_123')).toEqual({
      route: 'PetDetail',
      params: { petId: 'pet_123' },
    });
    expect(parseDeepLink('petchain://appointments/apt-123')).toEqual({
      route: 'Appointments',
      params: { appointmentId: 'apt-123' },
    });
    expect(parseDeepLink('petchainapp:///sos/sos123')).toEqual({
      route: 'Emergency',
      params: { sosId: 'sos123' },
    });
  });

  it('rejects arbitrary hosts for otherwise valid paths', () => {
    fc.assert(
      fc.property(fc.domain(), fc.constantFrom('pets', 'appointments', 'sos'), (host, route) => {
        fc.pre(host.toLowerCase() !== 'petchain.app');
        return parseDeepLink(`https://${host}/${route}/identifier`) === null;
      }),
    );
  });

  it('rejects unknown paths and malformed identifiers', () => {
    fc.assert(
      fc.property(fc.string(), (suffix) =>
        parseDeepLink(`https://petchain.app/unknown/${encodeURIComponent(suffix)}`) === null,
      ),
    );
    expect(parseDeepLink('https://petchain.app/pets/id/records/record')).toBeNull();
    expect(parseDeepLink('https://petchain.app/pets/%2F%2Fevil')).toBeNull();
  });

  it('rejects credentials, ports, query parameters, and fragments', () => {
    expect(parseDeepLink('https://user@petchain.app/pets/p1')).toBeNull();
    expect(parseDeepLink('https://petchain.app:8443/pets/p1')).toBeNull();
    expect(parseDeepLink('https://petchain.app/pets/p1?next=https://evil.example')).toBeNull();
    expect(parseDeepLink('https://petchain.app/pets/p1#profile')).toBeNull();
  });
});