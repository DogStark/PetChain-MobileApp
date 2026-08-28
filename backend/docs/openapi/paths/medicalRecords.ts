/**
 * OpenAPI path definitions for /medical-records endpoints.
 *
 * Medical records are immutable once blockchain-verified.
 * Blockchain anchoring happens asynchronously after record creation.
 */

export const medicalRecordPaths = {
  '/medical-records': {
    get: {
      tags: ['Medical Records'],
      summary: 'List medical records',
      description: 'Returns a paginated list of medical records with optional filters.',
      operationId: 'listMedicalRecords',
      security: [{ BearerAuth: [] }],
      parameters: [
        { $ref: '#/components/parameters/PageParam' },
        { $ref: '#/components/parameters/LimitParam' },
        { $ref: '#/components/parameters/SortByParam' },
        { $ref: '#/components/parameters/SortOrderParam' },
        {
          name: 'petId',
          in: 'query',
          schema: { type: 'string', format: 'uuid' },
          description: 'Filter by pet ID',
        },
        {
          name: 'vetId',
          in: 'query',
          schema: { type: 'string', format: 'uuid' },
          description: 'Filter by veterinarian ID',
        },
        {
          name: 'type',
          in: 'query',
          schema: {
            type: 'string',
            enum: ['checkup', 'vaccination', 'surgery', 'treatment', 'other'],
          },
          description: 'Filter by record type',
        },
        {
          name: 'startDate',
          in: 'query',
          schema: { type: 'string', format: 'date' },
          description: 'Filter records from this date (inclusive)',
          example: '2024-01-01',
        },
        {
          name: 'endDate',
          in: 'query',
          schema: { type: 'string', format: 'date' },
          description: 'Filter records up to this date (inclusive)',
          example: '2024-12-31',
        },
      ],
      responses: {
        '200': {
          description: 'Paginated list of medical records',
          content: {
            'application/json': {
              schema: {
                allOf: [
                  { $ref: '#/components/schemas/PaginatedResponse' },
                  {
                    properties: {
                      data: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/MedicalRecord' },
                      },
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
      tags: ['Medical Records'],
      summary: 'Create a medical record',
      description:
        'Creates a new medical record for a pet. After creation, the record hash is automatically anchored on the Stellar blockchain asynchronously. The `isBlockchainVerified` field will be `false` until anchoring completes.',
      operationId: 'createMedicalRecord',
      security: [{ BearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/CreateMedicalRecordRequest' },
            example: {
              petId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
              vetId: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
              type: 'vaccination',
              diagnosis: 'Healthy — routine annual checkup',
              treatment: 'Administered DHPP booster vaccine',
              notes: 'Pet is in excellent health. Weight stable at 28kg.',
              visitDate: '2024-03-15',
              nextVisitDate: '2025-03-15',
              vaccinations: [
                {
                  vaccineName: 'DHPP',
                  administeredAt: '2024-03-15',
                  nextDueDate: '2025-03-15',
                  manufacturer: 'Merck Animal Health',
                  batchNumber: 'LOT-2024-001',
                  dose: '1ml',
                },
              ],
            },
          },
        },
      },
      responses: {
        '201': {
          description: 'Medical record created successfully',
          content: {
            'application/json': {
              schema: {
                allOf: [
                  { $ref: '#/components/schemas/ApiResponse' },
                  { properties: { data: { $ref: '#/components/schemas/MedicalRecord' } } },
                ],
              },
            },
          },
        },
        '400': { $ref: '#/components/responses/BadRequest' },
        '401': { $ref: '#/components/responses/Unauthorized' },
        '403': { $ref: '#/components/responses/Forbidden' },
        '404': {
          description: 'Pet or vet not found',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
        },
        '500': { $ref: '#/components/responses/InternalServerError' },
      },
    },
  },

  '/medical-records/{id}': {
    get: {
      tags: ['Medical Records'],
      summary: 'Get medical record by ID',
      description:
        'Returns a single medical record with full details including blockchain verification status.',
      operationId: 'getMedicalRecordById',
      security: [{ BearerAuth: [] }],
      parameters: [{ $ref: '#/components/parameters/RecordIdParam' }],
      responses: {
        '200': {
          description: 'Medical record details',
          content: {
            'application/json': {
              schema: {
                allOf: [
                  { $ref: '#/components/schemas/ApiResponse' },
                  { properties: { data: { $ref: '#/components/schemas/MedicalRecord' } } },
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
      tags: ['Medical Records'],
      summary: 'Update a medical record',
      description:
        'Updates a medical record. Note: blockchain-verified records (`isBlockchainVerified: true`) cannot be modified — any update attempt will return 409.',
      operationId: 'updateMedicalRecord',
      security: [{ BearerAuth: [] }],
      parameters: [{ $ref: '#/components/parameters/RecordIdParam' }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/UpdateMedicalRecordRequest' },
          },
        },
      },
      responses: {
        '200': {
          description: 'Medical record updated successfully',
          content: {
            'application/json': {
              schema: {
                allOf: [
                  { $ref: '#/components/schemas/ApiResponse' },
                  { properties: { data: { $ref: '#/components/schemas/MedicalRecord' } } },
                ],
              },
            },
          },
        },
        '400': { $ref: '#/components/responses/BadRequest' },
        '401': { $ref: '#/components/responses/Unauthorized' },
        '403': { $ref: '#/components/responses/Forbidden' },
        '404': { $ref: '#/components/responses/NotFound' },
        '409': {
          description: 'Record is blockchain-verified and cannot be modified',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ApiError' },
              example: {
                success: false,
                error: {
                  code: 'RECORD_IMMUTABLE',
                  message: 'This record has been anchored on the blockchain and cannot be modified',
                },
                timestamp: '2024-01-15T10:30:00Z',
              },
            },
          },
        },
        '500': { $ref: '#/components/responses/InternalServerError' },
      },
    },

    delete: {
      tags: ['Medical Records'],
      summary: 'Delete a medical record',
      description: 'Deletes a medical record. Blockchain-verified records cannot be deleted.',
      operationId: 'deleteMedicalRecord',
      security: [{ BearerAuth: [] }],
      parameters: [{ $ref: '#/components/parameters/RecordIdParam' }],
      responses: {
        '204': { description: 'Medical record deleted successfully (no content)' },
        '401': { $ref: '#/components/responses/Unauthorized' },
        '403': { $ref: '#/components/responses/Forbidden' },
        '404': { $ref: '#/components/responses/NotFound' },
        '409': {
          description: 'Record is blockchain-verified and cannot be deleted',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
        },
        '500': { $ref: '#/components/responses/InternalServerError' },
      },
    },
  },

  '/medical-records/pet/{petId}': {
    get: {
      tags: ['Medical Records'],
      summary: 'Get all medical records for a pet',
      description:
        'Returns all medical records for a specific pet, ordered by visit date descending.',
      operationId: 'getMedicalRecordsByPet',
      security: [{ BearerAuth: [] }],
      parameters: [
        { $ref: '#/components/parameters/PetIdParam' },
        {
          name: 'type',
          in: 'query',
          schema: {
            type: 'string',
            enum: ['checkup', 'vaccination', 'surgery', 'treatment', 'other'],
          },
        },
        {
          name: 'startDate',
          in: 'query',
          schema: { type: 'string', format: 'date' },
          example: '2024-01-01',
        },
        {
          name: 'endDate',
          in: 'query',
          schema: { type: 'string', format: 'date' },
          example: '2024-12-31',
        },
        { $ref: '#/components/parameters/PageParam' },
        { $ref: '#/components/parameters/LimitParam' },
      ],
      responses: {
        '200': {
          description: 'Medical records for the pet',
          content: {
            'application/json': {
              schema: {
                allOf: [
                  { $ref: '#/components/schemas/PaginatedResponse' },
                  {
                    properties: {
                      data: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/MedicalRecord' },
                      },
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

  '/pets/{petId}/medical-records': {
    get: {
      tags: ['Medical Records'],
      summary: 'Get medical records for a pet (nested route)',
      description:
        'Alias for GET /medical-records/pet/{petId}. Supports the same query parameters.',
      operationId: 'getPetMedicalRecords',
      security: [{ BearerAuth: [] }],
      parameters: [
        { $ref: '#/components/parameters/PetIdParam' },
        {
          name: 'type',
          in: 'query',
          schema: {
            type: 'string',
            enum: ['checkup', 'vaccination', 'surgery', 'treatment', 'other'],
          },
        },
        {
          name: 'startDate',
          in: 'query',
          schema: { type: 'string', format: 'date' },
        },
        {
          name: 'endDate',
          in: 'query',
          schema: { type: 'string', format: 'date' },
        },
        { $ref: '#/components/parameters/PageParam' },
        { $ref: '#/components/parameters/LimitParam' },
      ],
      responses: {
        '200': {
          description: 'Medical records for the pet',
          content: {
            'application/json': {
              schema: {
                allOf: [
                  { $ref: '#/components/schemas/PaginatedResponse' },
                  {
                    properties: {
                      data: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/MedicalRecord' },
                      },
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
