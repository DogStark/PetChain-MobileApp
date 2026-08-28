/**
 * OpenAPI path definitions for /pets endpoints.
 */

export const petPaths = {
  '/pets': {
    get: {
      tags: ['Pets'],
      summary: 'List pets',
      description:
        'Returns a paginated list of pets. Owners see only their own pets; vets and admins can see all pets.',
      operationId: 'listPets',
      security: [{ BearerAuth: [] }],
      parameters: [
        { $ref: '#/components/parameters/PageParam' },
        { $ref: '#/components/parameters/LimitParam' },
        { $ref: '#/components/parameters/SortByParam' },
        { $ref: '#/components/parameters/SortOrderParam' },
        {
          name: 'ownerId',
          in: 'query',
          schema: { type: 'string', format: 'uuid' },
          description: 'Filter pets by owner ID',
          example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        },
        {
          name: 'species',
          in: 'query',
          schema: { type: 'string', enum: ['dog', 'cat', 'bird', 'rabbit', 'other'] },
          description: 'Filter by species',
        },
        {
          name: 'search',
          in: 'query',
          schema: { type: 'string' },
          description: 'Search by pet name (case-insensitive)',
          example: 'buddy',
        },
      ],
      responses: {
        '200': {
          description: 'Paginated list of pets',
          content: {
            'application/json': {
              schema: {
                allOf: [
                  { $ref: '#/components/schemas/PaginatedResponse' },
                  {
                    properties: {
                      data: { type: 'array', items: { $ref: '#/components/schemas/Pet' } },
                    },
                  },
                ],
              },
            },
          },
        },
        '401': { $ref: '#/components/responses/Unauthorized' },
        '500': { $ref: '#/components/responses/InternalServerError' },
      },
    },

    post: {
      tags: ['Pets'],
      summary: 'Create a new pet',
      description:
        "Registers a new pet. The `ownerId` must match the authenticated user's ID (or the user must be an admin).",
      operationId: 'createPet',
      security: [{ BearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/CreatePetRequest' },
            example: {
              name: 'Buddy',
              species: 'dog',
              breed: 'Golden Retriever',
              dateOfBirth: '2021-06-15',
              microchipId: '985141002512345',
              ownerId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
            },
          },
        },
      },
      responses: {
        '201': {
          description: 'Pet created successfully',
          content: {
            'application/json': {
              schema: {
                allOf: [
                  { $ref: '#/components/schemas/ApiResponse' },
                  { properties: { data: { $ref: '#/components/schemas/Pet' } } },
                ],
              },
            },
          },
        },
        '400': { $ref: '#/components/responses/BadRequest' },
        '401': { $ref: '#/components/responses/Unauthorized' },
        '403': { $ref: '#/components/responses/Forbidden' },
        '500': { $ref: '#/components/responses/InternalServerError' },
      },
    },
  },

  '/pets/{id}': {
    get: {
      tags: ['Pets'],
      summary: 'Get pet by ID',
      description: 'Returns full pet details including owner summary.',
      operationId: 'getPetById',
      security: [{ BearerAuth: [] }],
      parameters: [{ $ref: '#/components/parameters/PetIdParam' }],
      responses: {
        '200': {
          description: 'Pet details',
          content: {
            'application/json': {
              schema: {
                allOf: [
                  { $ref: '#/components/schemas/ApiResponse' },
                  { properties: { data: { $ref: '#/components/schemas/Pet' } } },
                ],
              },
            },
          },
        },
        '401': { $ref: '#/components/responses/Unauthorized' },
        '403': { $ref: '#/components/responses/Forbidden' },
        '404': { $ref: '#/components/responses/NotFound' },
        '500': { $ref: '#/components/responses/InternalServerError' },
      },
    },

    put: {
      tags: ['Pets'],
      summary: 'Update pet details',
      description: 'Updates editable pet fields. Only the pet owner or an admin can update a pet.',
      operationId: 'updatePet',
      security: [{ BearerAuth: [] }],
      parameters: [{ $ref: '#/components/parameters/PetIdParam' }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/UpdatePetRequest' },
            example: { name: 'Buddy Jr.', breed: 'Labrador Retriever' },
          },
        },
      },
      responses: {
        '200': {
          description: 'Pet updated successfully',
          content: {
            'application/json': {
              schema: {
                allOf: [
                  { $ref: '#/components/schemas/ApiResponse' },
                  { properties: { data: { $ref: '#/components/schemas/Pet' } } },
                ],
              },
            },
          },
        },
        '400': { $ref: '#/components/responses/BadRequest' },
        '401': { $ref: '#/components/responses/Unauthorized' },
        '403': { $ref: '#/components/responses/Forbidden' },
        '404': { $ref: '#/components/responses/NotFound' },
        '500': { $ref: '#/components/responses/InternalServerError' },
      },
    },

    delete: {
      tags: ['Pets'],
      summary: 'Delete a pet',
      description:
        'Permanently deletes a pet and all associated records. Only the pet owner or an admin can delete a pet.',
      operationId: 'deletePet',
      security: [{ BearerAuth: [] }],
      parameters: [{ $ref: '#/components/parameters/PetIdParam' }],
      responses: {
        '204': { description: 'Pet deleted successfully (no content)' },
        '401': { $ref: '#/components/responses/Unauthorized' },
        '403': { $ref: '#/components/responses/Forbidden' },
        '404': { $ref: '#/components/responses/NotFound' },
        '500': { $ref: '#/components/responses/InternalServerError' },
      },
    },
  },

  '/pets/qr/{qrCode}': {
    get: {
      tags: ['Pets'],
      summary: 'Look up pet by QR code',
      description:
        'Retrieves a pet profile by scanning its QR code. Used by the QRScannerScreen. The QR code value is a URL-encoded string containing the pet ID and a CryptoJS checksum for tamper detection.',
      operationId: 'getPetByQRCode',
      security: [{ BearerAuth: [] }],
      parameters: [
        {
          name: 'qrCode',
          in: 'path',
          required: true,
          schema: { type: 'string' },
          description: "URL-encoded QR code value from the pet's QR tag",
          example: 'petchain%3A%2F%2Fpet%2Fa1b2c3d4-e5f6-7890-abcd-ef1234567890',
        },
      ],
      responses: {
        '200': {
          description: 'Pet found',
          content: {
            'application/json': {
              schema: {
                allOf: [
                  { $ref: '#/components/schemas/ApiResponse' },
                  { properties: { data: { $ref: '#/components/schemas/Pet' } } },
                ],
              },
            },
          },
        },
        '400': {
          description: 'Invalid or tampered QR code',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ApiError' },
              example: {
                success: false,
                error: { code: 'INVALID_QR_CODE', message: 'QR code checksum validation failed' },
                timestamp: '2024-01-15T10:30:00Z',
              },
            },
          },
        },
        '401': { $ref: '#/components/responses/Unauthorized' },
        '404': { $ref: '#/components/responses/NotFound' },
        '500': { $ref: '#/components/responses/InternalServerError' },
      },
    },
  },

  '/pets/owner/{ownerId}': {
    get: {
      tags: ['Pets'],
      summary: 'List pets by owner',
      description: 'Returns all pets belonging to a specific owner.',
      operationId: 'getPetsByOwner',
      security: [{ BearerAuth: [] }],
      parameters: [
        {
          name: 'ownerId',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' },
          description: 'Owner user ID',
          example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        },
      ],
      responses: {
        '200': {
          description: 'List of pets for the owner',
          content: {
            'application/json': {
              schema: {
                allOf: [
                  { $ref: '#/components/schemas/ApiResponse' },
                  {
                    properties: {
                      data: { type: 'array', items: { $ref: '#/components/schemas/Pet' } },
                    },
                  },
                ],
              },
            },
          },
        },
        '401': { $ref: '#/components/responses/Unauthorized' },
        '403': { $ref: '#/components/responses/Forbidden' },
        '404': { $ref: '#/components/responses/NotFound' },
        '500': { $ref: '#/components/responses/InternalServerError' },
      },
    },
  },
} as const;
