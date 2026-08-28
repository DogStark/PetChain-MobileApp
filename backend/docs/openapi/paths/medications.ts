/**
 * OpenAPI path definitions for /medications endpoints.
 */

export const medicationPaths = {
  '/medications': {
    get: {
      tags: ['Medications'],
      summary: 'List medications',
      description: 'Returns medications for a pet. The `petId` query parameter is required.',
      operationId: 'listMedications',
      security: [{ BearerAuth: [] }],
      parameters: [
        {
          name: 'petId',
          in: 'query',
          required: true,
          schema: { type: 'string', format: 'uuid' },
          description: 'Pet ID to fetch medications for',
          example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        },
        {
          name: 'status',
          in: 'query',
          schema: {
            type: 'string',
            enum: ['active', 'paused', 'completed', 'discontinued'],
          },
          description: 'Filter by medication status',
        },
      ],
      responses: {
        '200': {
          description: 'List of medications',
          content: {
            'application/json': {
              schema: {
                allOf: [
                  { $ref: '#/components/schemas/ApiResponse' },
                  {
                    properties: {
                      data: { type: 'array', items: { $ref: '#/components/schemas/Medication' } },
                    },
                  },
                ],
              },
            },
          },
        },
        '400': {
          description: 'Missing required petId parameter',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
        },
        '401': { $ref: '#/components/responses/Unauthorized' },
        '500': { $ref: '#/components/responses/InternalServerError' },
      },
    },

    post: {
      tags: ['Medications'],
      summary: 'Create a medication schedule',
      description: 'Creates a new medication schedule for a pet.',
      operationId: 'createMedication',
      security: [{ BearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/CreateMedicationRequest' },
            example: {
              petId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
              name: 'Apoquel',
              dosage: '16mg',
              frequency: 'once_daily',
              durationDays: 30,
              startDate: '2024-03-15',
              endDate: '2024-04-14',
              status: 'active',
              instructions: 'Give with food. Monitor for side effects.',
            },
          },
        },
      },
      responses: {
        '201': {
          description: 'Medication schedule created',
          content: {
            'application/json': {
              schema: {
                allOf: [
                  { $ref: '#/components/schemas/ApiResponse' },
                  { properties: { data: { $ref: '#/components/schemas/Medication' } } },
                ],
              },
            },
          },
        },
        '400': { $ref: '#/components/responses/BadRequest' },
        '401': { $ref: '#/components/responses/Unauthorized' },
        '403': { $ref: '#/components/responses/Forbidden' },
        '404': {
          description: 'Pet not found',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
        },
        '500': { $ref: '#/components/responses/InternalServerError' },
      },
    },
  },

  '/medications/{id}': {
    put: {
      tags: ['Medications'],
      summary: 'Update a medication',
      description:
        'Updates a medication schedule. Use `status: "discontinued"` to stop a medication early.',
      operationId: 'updateMedication',
      security: [{ BearerAuth: [] }],
      parameters: [{ $ref: '#/components/parameters/MedicationIdParam' }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/UpdateMedicationRequest' },
            examples: {
              pause: {
                summary: 'Pause medication',
                value: { status: 'paused' },
              },
              discontinue: {
                summary: 'Discontinue medication',
                value: { status: 'discontinued', endDate: '2024-03-20' },
              },
              updateDosage: {
                summary: 'Update dosage',
                value: { dosage: '8mg', instructions: 'Reduced dose — give with food' },
              },
            },
          },
        },
      },
      responses: {
        '200': {
          description: 'Medication updated successfully',
          content: {
            'application/json': {
              schema: {
                allOf: [
                  { $ref: '#/components/schemas/ApiResponse' },
                  { properties: { data: { $ref: '#/components/schemas/Medication' } } },
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
      tags: ['Medications'],
      summary: 'Delete a medication',
      description: 'Permanently deletes a medication record.',
      operationId: 'deleteMedication',
      security: [{ BearerAuth: [] }],
      parameters: [{ $ref: '#/components/parameters/MedicationIdParam' }],
      responses: {
        '204': { description: 'Medication deleted successfully (no content)' },
        '401': { $ref: '#/components/responses/Unauthorized' },
        '403': { $ref: '#/components/responses/Forbidden' },
        '404': { $ref: '#/components/responses/NotFound' },
        '500': { $ref: '#/components/responses/InternalServerError' },
      },
    },
  },
} as const;
