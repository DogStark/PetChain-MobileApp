/**
 * OpenAPI schema definitions for User endpoints.
 */

export const userSchemas = {
  User: {
    type: 'object',
    required: [
      'id',
      'email',
      'name',
      'role',
      'pets',
      'createdAt',
      'updatedAt',
      'isEmailVerified',
      'authProvider',
    ],
    properties: {
      id: { $ref: '#/components/schemas/UUID' },
      email: { type: 'string', format: 'email', example: 'jane.doe@example.com' },
      name: { type: 'string', example: 'Jane Doe' },
      phone: { type: 'string', example: '+14155552671' },
      role: {
        type: 'string',
        enum: ['owner', 'vet', 'admin'],
        example: 'owner',
        description: 'User role controlling access permissions',
      },
      authProvider: {
        type: 'string',
        enum: ['local', 'google', 'apple'],
        example: 'local',
      },
      isEmailVerified: { type: 'boolean', example: true },
      lastLoginAt: { $ref: '#/components/schemas/ISODateTime' },
      pets: {
        type: 'array',
        items: { $ref: '#/components/schemas/PetReference' },
        description: 'Lightweight references to pets owned by this user',
      },
      createdAt: { $ref: '#/components/schemas/ISODateTime' },
      updatedAt: { $ref: '#/components/schemas/ISODateTime' },
    },
  },

  PetReference: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { $ref: '#/components/schemas/UUID' },
      name: { type: 'string', example: 'Buddy' },
    },
  },

  UpdateUserRequest: {
    type: 'object',
    properties: {
      name: { type: 'string', minLength: 2, maxLength: 100, example: 'Jane Smith' },
      phone: { type: 'string', example: '+14155552671' },
      role: { type: 'string', enum: ['owner', 'vet', 'admin'], example: 'vet' },
    },
  },

  UpdateUserResponse: {
    type: 'object',
    required: ['id', 'email', 'name', 'role', 'updatedAt'],
    properties: {
      id: { $ref: '#/components/schemas/UUID' },
      email: { type: 'string', format: 'email', example: 'jane.doe@example.com' },
      name: { type: 'string', example: 'Jane Smith' },
      phone: { type: 'string', example: '+14155552671' },
      role: { type: 'string', enum: ['owner', 'vet', 'admin'], example: 'vet' },
      updatedAt: { $ref: '#/components/schemas/ISODateTime' },
    },
  },
} as const;
