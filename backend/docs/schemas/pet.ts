/**
 * OpenAPI schema definitions for Pet endpoints.
 */

export const petSchemas = {
  Pet: {
    type: 'object',
    required: ['id', 'name', 'species', 'ownerId', 'createdAt', 'updatedAt'],
    properties: {
      id: { $ref: '#/components/schemas/UUID' },
      name: { type: 'string', minLength: 1, maxLength: 100, example: 'Buddy' },
      species: {
        type: 'string',
        enum: ['dog', 'cat', 'bird', 'rabbit', 'other'],
        example: 'dog',
      },
      breed: { type: 'string', example: 'Golden Retriever' },
      dateOfBirth: { $ref: '#/components/schemas/ISODate' },
      microchipId: {
        type: 'string',
        example: '985141002512345',
        description: '15-digit ISO 11784/11785 microchip identifier',
      },
      photoUrl: {
        type: 'string',
        format: 'uri',
        example: 'https://storage.petchain.app/pets/buddy.jpg',
      },
      ownerId: { $ref: '#/components/schemas/UUID' },
      owner: {
        type: 'object',
        properties: {
          id: { $ref: '#/components/schemas/UUID' },
          name: { type: 'string', example: 'Jane Doe' },
          email: { type: 'string', format: 'email', example: 'jane.doe@example.com' },
        },
      },
      createdAt: { $ref: '#/components/schemas/ISODateTime' },
      updatedAt: { $ref: '#/components/schemas/ISODateTime' },
    },
  },

  CreatePetRequest: {
    type: 'object',
    required: ['name', 'species', 'ownerId'],
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 100, example: 'Buddy' },
      species: {
        type: 'string',
        enum: ['dog', 'cat', 'bird', 'rabbit', 'other'],
        example: 'dog',
      },
      breed: { type: 'string', example: 'Golden Retriever' },
      dateOfBirth: {
        $ref: '#/components/schemas/ISODate',
        description: 'Pet date of birth in YYYY-MM-DD format',
      },
      microchipId: { type: 'string', example: '985141002512345' },
      photoUrl: {
        type: 'string',
        format: 'uri',
        example: 'https://storage.petchain.app/pets/buddy.jpg',
      },
      ownerId: { $ref: '#/components/schemas/UUID' },
    },
  },

  UpdatePetRequest: {
    type: 'object',
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 100, example: 'Buddy Jr.' },
      species: { type: 'string', enum: ['dog', 'cat', 'bird', 'rabbit', 'other'] },
      breed: { type: 'string', example: 'Labrador Retriever' },
      dateOfBirth: { $ref: '#/components/schemas/ISODate' },
      microchipId: { type: 'string', example: '985141002512345' },
      photoUrl: { type: 'string', format: 'uri' },
    },
  },
} as const;
