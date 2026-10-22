/**
 * OpenAPI path definitions for /appointments endpoints.
 */

export const appointmentPaths = {
  '/appointments': {
    get: {
      tags: ['Appointments'],
      summary: 'List appointments',
      description:
        "Returns appointments. Owners see their pets' appointments; vets see their own appointments; admins see all.",
      operationId: 'listAppointments',
      security: [{ BearerAuth: [] }],
      parameters: [
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
          description: 'Filter by vet ID',
        },
        {
          name: 'status',
          in: 'query',
          schema: {
            type: 'string',
            enum: ['PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW', 'RESCHEDULED'],
          },
          description: 'Filter by appointment status',
        },
        {
          name: 'type',
          in: 'query',
          schema: {
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
        },
        {
          name: 'fromDate',
          in: 'query',
          schema: { type: 'string', format: 'date' },
          description: 'Filter appointments from this date (inclusive)',
          example: '2024-03-01',
        },
        {
          name: 'toDate',
          in: 'query',
          schema: { type: 'string', format: 'date' },
          description: 'Filter appointments up to this date (inclusive)',
          example: '2024-03-31',
        },
        { $ref: '#/components/parameters/PageParam' },
        { $ref: '#/components/parameters/LimitParam' },
      ],
      responses: {
        '200': {
          description: 'List of appointments',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/AppointmentListResponse' },
            },
          },
        },
        '401': { $ref: '#/components/responses/Unauthorized' },
        '500': { $ref: '#/components/responses/InternalServerError' },
      },
    },

    post: {
      tags: ['Appointments'],
      summary: 'Create an appointment',
      description: 'Books a new appointment for a pet with a veterinarian.',
      operationId: 'createAppointment',
      security: [{ BearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/CreateAppointmentRequest' },
            example: {
              petId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
              vetId: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
              date: '2024-03-15',
              time: '14:30',
              durationMinutes: 30,
              type: 'VACCINATION',
              status: 'PENDING',
              notes: 'Annual booster vaccines due',
              reminder: { isEnabled: true, minutesBefore: 60, notificationMethod: 'push' },
            },
          },
        },
      },
      responses: {
        '201': {
          description: 'Appointment created successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  success: { type: 'boolean', example: true },
                  data: { $ref: '#/components/schemas/Appointment' },
                  message: { type: 'string', example: 'Appointment booked successfully' },
                },
              },
            },
          },
        },
        '400': { $ref: '#/components/responses/BadRequest' },
        '401': { $ref: '#/components/responses/Unauthorized' },
        '404': {
          description: 'Pet or vet not found',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
        },
        '409': {
          description: 'Time slot already booked',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ApiError' },
              example: {
                success: false,
                error: {
                  code: 'SLOT_UNAVAILABLE',
                  message: 'The requested time slot is already booked',
                },
                timestamp: '2024-01-15T10:30:00Z',
              },
            },
          },
        },
        '500': { $ref: '#/components/responses/InternalServerError' },
      },
    },
  },

  '/appointments/{id}': {
    get: {
      tags: ['Appointments'],
      summary: 'Get appointment by ID',
      description: 'Returns full appointment details including vet and pet summaries.',
      operationId: 'getAppointmentById',
      security: [{ BearerAuth: [] }],
      parameters: [{ $ref: '#/components/parameters/AppointmentIdParam' }],
      responses: {
        '200': {
          description: 'Appointment details',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  success: { type: 'boolean', example: true },
                  data: { $ref: '#/components/schemas/Appointment' },
                },
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
      tags: ['Appointments'],
      summary: 'Update an appointment',
      description:
        'Updates appointment details. To cancel, set `status` to `CANCELLED` and provide `cancellationReason`.',
      operationId: 'updateAppointment',
      security: [{ BearerAuth: [] }],
      parameters: [{ $ref: '#/components/parameters/AppointmentIdParam' }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/UpdateAppointmentRequest' },
            examples: {
              reschedule: {
                summary: 'Reschedule appointment',
                value: { date: '2024-03-20', time: '10:00', status: 'RESCHEDULED' },
              },
              cancel: {
                summary: 'Cancel appointment',
                value: { status: 'CANCELLED', cancellationReason: 'Owner unavailable' },
              },
              confirm: {
                summary: 'Confirm appointment',
                value: { status: 'CONFIRMED' },
              },
            },
          },
        },
      },
      responses: {
        '200': {
          description: 'Appointment updated successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  success: { type: 'boolean', example: true },
                  data: { $ref: '#/components/schemas/Appointment' },
                },
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
  },

  '/appointments/{id}/calendar-sync': {
    post: {
      tags: ['Appointments'],
      summary: 'Sync an appointment with the device calendar',
      description:
        'Idempotently imports or exports an appointment against the device calendar. External event IDs and source ownership are persisted so retries do not duplicate events. When both the server and device copies changed since the last sync, the conflict is reported with both timestamps preserved and must be resolved explicitly via `resolution`.',
      operationId: 'syncAppointmentCalendar',
      security: [{ BearerAuth: [] }],
      parameters: [{ $ref: '#/components/parameters/AppointmentIdParam' }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/CalendarSyncRequest' },
            examples: {
              export: {
                summary: 'Export appointment to device calendar',
                value: {
                  direction: 'EXPORT',
                  source: 'DEVICE',
                  externalEventId: 'device-event-123',
                  deviceUpdatedAt: '2024-03-15T14:30:00Z',
                },
              },
              import: {
                summary: 'Import device calendar event',
                value: {
                  direction: 'IMPORT',
                  source: 'DEVICE',
                  externalEventId: 'device-event-123',
                  deviceUpdatedAt: '2024-03-16T09:00:00Z',
                  recurrenceRule: 'FREQ=WEEKLY;COUNT=4',
                  timezone: 'America/New_York',
                },
              },
              resolve: {
                summary: 'Resolve a detected conflict',
                value: {
                  direction: 'IMPORT',
                  source: 'DEVICE',
                  externalEventId: 'device-event-123',
                  deviceUpdatedAt: '2024-03-16T09:00:00Z',
                  resolution: 'KEEP_DEVICE',
                },
              },
            },
          },
        },
      },
      responses: {
        '200': {
          description:
            'Sync applied (or conflict reported). When `status` is `CONFLICT`, both `serverUpdatedAt` and `deviceUpdatedAt` are preserved and `resolution` is required on the next request.',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CalendarSyncResponse' },
              examples: {
                synced: {
                  summary: 'Sync applied idempotently',
                  value: {
                    success: true,
                    data: {
                      status: 'SYNCED',
                      externalEventId: 'device-event-123',
                      source: 'DEVICE',
                      serverUpdatedAt: '2024-03-15T14:30:00Z',
                      deviceUpdatedAt: '2024-03-16T09:00:00Z',
                    },
                  },
                },
                conflict: {
                  summary: 'Conflict requires explicit resolution',
                  value: {
                    success: true,
                    data: {
                      status: 'CONFLICT',
                      externalEventId: 'device-event-123',
                      source: 'DEVICE',
                      serverUpdatedAt: '2024-03-15T14:30:00Z',
                      deviceUpdatedAt: '2024-03-16T09:00:00Z',
                      resolution: null,
                    },
                  },
                },
              },
            },
          },
        },
        '400': { $ref: '#/components/responses/BadRequest' },
        '401': { $ref: '#/components/responses/Unauthorized' },
        '403': {
          description: 'Calendar permission revoked or sync not permitted',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ApiError' },
              example: {
                success: false,
                error: {
                  code: 'CALENDAR_PERMISSION_REVOKED',
                  message: 'Calendar access was revoked; re-grant permission to sync',
                },
                timestamp: '2024-01-15T10:30:00Z',
              },
            },
          },
        },
        '404': { $ref: '#/components/responses/NotFound' },
        '409': {
          description: 'Unresolved calendar-sync conflict',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ApiError' },
              example: {
                success: false,
                error: {
                  code: 'CALENDAR_SYNC_CONFLICT',
                  message: 'Both copies changed; provide an explicit resolution',
                },
                timestamp: '2024-01-15T10:30:00Z',
              },
            },
          },
        },
        '500': { $ref: '#/components/responses/InternalServerError' },
      },
    },
  },
} as const;
