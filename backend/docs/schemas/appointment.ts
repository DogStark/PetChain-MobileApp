/**
 * OpenAPI schema definitions for Appointment endpoints.
 */

export const appointmentSchemas = {
  Appointment: {
    type: 'object',
    required: ['id', 'petId', 'vetId', 'date', 'time', 'type', 'status', 'createdAt', 'updatedAt'],
    properties: {
      id: { $ref: '#/components/schemas/UUID' },
      petId: { $ref: '#/components/schemas/UUID' },
      vetId: { $ref: '#/components/schemas/UUID' },
      date: {
        type: 'string',
        format: 'date',
        example: '2024-03-15',
        description: 'Appointment date in YYYY-MM-DD format',
      },
      time: {
        type: 'string',
        pattern: '^([01]\\d|2[0-3]):[0-5]\\d$',
        example: '14:30',
        description: '24-hour time format HH:MM',
      },
      durationMinutes: {
        type: 'integer',
        minimum: 15,
        maximum: 480,
        default: 30,
        example: 30,
      },
      type: {
        type: 'string',
        enum: [
          'ROUTINE_CHECKUP',
          'VACCINATION',
          'SURGERY',
          'DENTAL',
          'GROOMING',
          'EMERGENCY',
          'FOLLOW_UP',
          'DIAGNOSTIC',
          'SPECIALIST_REFERRAL',
          'NUTRITION_CONSULTATION',
        ],
        example: 'VACCINATION',
      },
      status: {
        type: 'string',
        enum: ['PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW', 'RESCHEDULED'],
        example: 'CONFIRMED',
      },
      notes: { type: 'string', example: 'Annual booster vaccines due' },
      vet: { $ref: '#/components/schemas/AppointmentVetSummary' },
      pet: { $ref: '#/components/schemas/AppointmentPetSummary' },
      reminder: { $ref: '#/components/schemas/AppointmentReminder' },
      cancelledAt: { $ref: '#/components/schemas/ISODateTime' },
      cancellationReason: { type: 'string', example: 'Owner unavailable' },
      createdAt: { $ref: '#/components/schemas/ISODateTime' },
      updatedAt: { $ref: '#/components/schemas/ISODateTime' },
    },
  },

  AppointmentVetSummary: {
    type: 'object',
    required: ['vetId', 'name', 'clinicName'],
    properties: {
      vetId: { $ref: '#/components/schemas/UUID' },
      name: { type: 'string', example: 'Dr. Sarah Johnson' },
      specialization: { type: 'string', example: 'General Practice' },
      clinicName: { type: 'string', example: 'Downtown Animal Hospital' },
      clinicPhone: { type: 'string', example: '+14155550100' },
      clinicAddress: { type: 'string', example: '123 Main St, San Francisco, CA 94102' },
    },
  },

  AppointmentPetSummary: {
    type: 'object',
    required: ['petId', 'name', 'species'],
    properties: {
      petId: { $ref: '#/components/schemas/UUID' },
      name: { type: 'string', example: 'Buddy' },
      species: { type: 'string', example: 'dog' },
      breed: { type: 'string', example: 'Golden Retriever' },
      age: { type: 'number', example: 3.5 },
    },
  },

  AppointmentReminder: {
    type: 'object',
    required: ['isEnabled', 'minutesBefore', 'notificationMethod'],
    properties: {
      isEnabled: { type: 'boolean', example: true },
      minutesBefore: {
        type: 'integer',
        minimum: 5,
        example: 60,
        description: 'Minutes before appointment to send reminder',
      },
      notificationMethod: {
        type: 'string',
        enum: ['push', 'email', 'sms'],
        example: 'push',
      },
    },
  },

  CreateAppointmentRequest: {
    type: 'object',
    required: ['petId', 'vetId', 'date', 'time', 'type', 'status'],
    properties: {
      petId: { $ref: '#/components/schemas/UUID' },
      vetId: { $ref: '#/components/schemas/UUID' },
      date: { type: 'string', format: 'date', example: '2024-03-15' },
      time: { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$', example: '14:30' },
      durationMinutes: { type: 'integer', minimum: 15, maximum: 480, default: 30, example: 30 },
      type: {
        type: 'string',
        enum: [
          'ROUTINE_CHECKUP',
          'VACCINATION',
          'SURGERY',
          'DENTAL',
          'GROOMING',
          'EMERGENCY',
          'FOLLOW_UP',
          'DIAGNOSTIC',
          'SPECIALIST_REFERRAL',
          'NUTRITION_CONSULTATION',
        ],
        example: 'VACCINATION',
      },
      status: {
        type: 'string',
        enum: ['PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW', 'RESCHEDULED'],
        default: 'PENDING',
        example: 'PENDING',
      },
      notes: { type: 'string', example: 'Annual booster vaccines due' },
      reminder: { $ref: '#/components/schemas/AppointmentReminder' },
    },
  },

  UpdateAppointmentRequest: {
    type: 'object',
    properties: {
      date: { type: 'string', format: 'date', example: '2024-03-20' },
      time: { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$', example: '10:00' },
      durationMinutes: { type: 'integer', minimum: 15, maximum: 480 },
      type: {
        type: 'string',
        enum: [
          'ROUTINE_CHECKUP',
          'VACCINATION',
          'SURGERY',
          'DENTAL',
          'GROOMING',
          'EMERGENCY',
          'FOLLOW_UP',
          'DIAGNOSTIC',
          'SPECIALIST_REFERRAL',
          'NUTRITION_CONSULTATION',
        ],
      },
      status: {
        type: 'string',
        enum: ['PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW', 'RESCHEDULED'],
      },
      notes: { type: 'string' },
      reminder: { $ref: '#/components/schemas/AppointmentReminder' },
      cancellationReason: { type: 'string', example: 'Owner unavailable' },
    },
  },

  AppointmentListResponse: {
    type: 'object',
    required: ['success', 'data', 'total'],
    properties: {
      success: { type: 'boolean', example: true },
      data: { type: 'array', items: { $ref: '#/components/schemas/Appointment' } },
      total: { type: 'integer', example: 5 },
      page: { type: 'integer', example: 1 },
      pageSize: { type: 'integer', example: 20 },
      message: { type: 'string' },
    },
  },
} as const;
