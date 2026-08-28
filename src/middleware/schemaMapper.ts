import { type AxiosResponse } from 'axios';

/**
 * Registry of mappers for different API endpoints or data structures.
 * This allows the app to handle legacy data formats gracefully.
 */

type MapperFunction = (data: unknown) => unknown;

const mappers: Record<string, MapperFunction> = {
  '/pets': (data: unknown) => {
    if (Array.isArray(data)) {
      return data.map(mapPet);
    }
    return mapPet(data);
  },

  '/pets/:id': (data: unknown) => mapPet(data),
};

function mapPet(pet: unknown) {
  if (!pet || typeof pet !== 'object') return pet;
  const p = pet as Record<string, unknown>;

  if (p.pet_name && !p.name) {
    p.name = p.pet_name;
  }
  if (!p.species) {
    p.species = 'other';
  }
  if (!p.createdAt) {
    p.createdAt = new Date().toISOString();
  }
  return p;
}

/**
 * Interceptor logic to apply mappers to responses.
 */
export const applySchemaMapping = (response: AxiosResponse): AxiosResponse => {
  const { config, data } = response;
  const url = config.url || '';

  // Find a matching mapper for the URL
  // (Simplistic matching for demo: exact match or startsWith)
  const mapperKey = Object.keys(mappers).find(
    (key) =>
      url.endsWith(key) ||
      (key.includes(':id') && url.match(new RegExp(key.replace(':id', '[^/]+')))),
  );

  if (mapperKey && data) {
    response.data = mappers[mapperKey](data);
  }

  return response;
};
