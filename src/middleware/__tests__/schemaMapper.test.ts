import { type AxiosResponse } from 'axios';

import { applySchemaMapping } from '../schemaMapper';

describe('schemaMapper', () => {
  it('should map pet_name to name for /pets endpoint', () => {
    const mockResponse = {
      config: { url: 'https://api.petchain.app/api/pets' },
      data: [
        { id: '1', pet_name: 'Buddy', species: 'dog' },
        { id: '2', name: 'Max', species: 'cat' },
      ],
    } as AxiosResponse;

    const result = applySchemaMapping(mockResponse);
    expect(result.data[0].name).toBe('Buddy');
    expect(result.data[1].name).toBe('Max');
  });

  it('should provide default species if missing', () => {
    const mockResponse = {
      config: { url: 'https://api.petchain.app/api/pets/1' },
      data: { id: '1', name: 'Buddy' },
    } as AxiosResponse;

    const result = applySchemaMapping(mockResponse);
    expect(result.data.species).toBe('other');
  });

  it('should not modify data if no mapper matches', () => {
    const mockData = { some: 'data' };
    const mockResponse = {
      config: { url: 'https://api.petchain.app/api/unknown' },
      data: mockData,
    } as AxiosResponse;

    const result = applySchemaMapping(mockResponse);
    expect(result.data).toBe(mockData);
  });
});
