/**
 * OpenAPI schema definitions for Medication endpoints.
 */

export const medicationSchemas = {
  Medication: {
    type: 'object',
    required: [
      'id',
      'petId',
      'name',
      'dosage',
      'frequency',
      'durationDays',
      'startDate',
      'status',
      'createdAt',
      'updatedAt',
    ],
    properties: {
      id: { $ref: '#/components/schemas/UUID' },
      petId: { $ref: '#/components/schemas/UUID' },
      name: { type: 'string', example: 'Apoquel' },
      dosage: { type: 'string', example: '16mg' },
      frequency: {
        type: 'string',
        enum: [
          'once_daily',
          'twice_daily',
          'three_times_daily',
          'every_other_day',
          'weekly',
          'as_needed',
        ],
        example: 'once_daily',
        description: 'How often the medication should be administered',
      },
      durationDays: {
        type: 'integer',
        minimum: 1,
        example: 30,
        description: 'Total duration of the medication course in days',
      },
      startDate: { $ref: '#/components/schemas/ISODate' },
      endDate: { $ref: '#/components/schemas/ISODate' },
      status: {
        type: 'string',
        enum: ['active', 'paused', 'completed', 'discontinued'],
        example: 'active',
      },
      instructions: {
        type: 'string',
        example: 'Give with food. Monitor for side effects.',
      },
      createdAt: { $ref: '#/components/schemas/ISODateTime' },
      updatedAt: { $ref: '#/components/schemas/ISODateTime' },
    },
  },

  CreateMedicationRequest: {
    type: 'object',
    required: ['petId', 'name', 'dosage', 'frequency', 'durationDays', 'startDate'],
    properties: {
      petId: { $ref: '#/components/schemas/UUID' },
      name: { type: 'string', minLength: 1, maxLength: 200, example: 'Apoquel' },
      dosage: { type: 'string', example: '16mg' },
      frequency: {
        type: 'string',
        enum: [
          'once_daily',
          'twice_daily',
          'three_times_daily',
          'every_other_day',
          'weekly',
          'as_needed',
        ],
        example: 'once_daily',
      },
      durationDays: { type: 'integer', minimum: 1, example: 30 },
      startDate: { $ref: '#/components/schemas/ISODate' },
      endDate: { $ref: '#/components/schemas/ISODate' },
      status: {
        type: 'string',
        enum: ['active', 'paused', 'completed', 'discontinued'],
        default: 'active',
        example: 'active',
      },
      instructions: { type: 'string', example: 'Give with food' },
    },
  },

  UpdateMedicationRequest: {
    type: 'object',
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 200 },
      dosage: { type: 'string' },
      frequency: {
        type: 'string',
        enum: [
          'once_daily',
          'twice_daily',
          'three_times_daily',
          'every_other_day',
          'weekly',
          'as_needed',
        ],
      },
      durationDays: { type: 'integer', minimum: 1 },
      startDate: { $ref: '#/components/schemas/ISODate' },
      endDate: { $ref: '#/components/schemas/ISODate' },
      status: {
        type: 'string',
        enum: ['active', 'paused', 'completed', 'discontinued'],
      },
      instructions: { type: 'string' },
    },
  },
} as const;
