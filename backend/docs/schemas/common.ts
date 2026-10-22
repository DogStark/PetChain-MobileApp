/**
 * Common reusable OpenAPI schema components.
 * These are referenced throughout the spec via $ref.
 */

export const commonSchemas = {
  // ─── Generic wrappers ────────────────────────────────────────────────────────

  ApiResponse: {
    type: 'object',
    required: ['success', 'data', 'timestamp'],
    properties: {
      success: { type: 'boolean', example: true },
      data: {},
      message: { type: 'string', example: 'Operation completed successfully' },
      timestamp: { type: 'string', format: 'date-time', example: '2024-01-15T10:30:00Z' },
    },
  },

  ApiError: {
    type: 'object',
    required: ['success', 'error', 'timestamp'],
    properties: {
      success: { type: 'boolean', example: false },
      error: {
        type: 'object',
        required: ['code', 'message'],
        properties: {
          code: { type: 'string', example: 'VALIDATION_ERROR' },
          message: { type: 'string', example: 'Invalid input data' },
          details: {
            type: 'object',
            additionalProperties: true,
            example: { field: 'email', issue: 'Invalid format' },
          },
        },
      },
      timestamp: { type: 'string', format: 'date-time', example: '2024-01-15T10:30:00Z' },
    },
  },

  PaginationMeta: {
    type: 'object',
    required: ['page', 'limit', 'total', 'totalPages', 'hasNext', 'hasPrev'],
    properties: {
      page: { type: 'integer', minimum: 1, example: 1 },
      limit: { type: 'integer', minimum: 1, maximum: 100, example: 20 },
      total: { type: 'integer', minimum: 0, example: 42 },
      totalPages: { type: 'integer', minimum: 0, example: 3 },
      hasNext: { type: 'boolean', example: true },
      hasPrev: { type: 'boolean', example: false },
    },
  },

  PaginatedResponse: {
    type: 'object',
    required: ['success', 'data', 'pagination', 'timestamp'],
    properties: {
      success: { type: 'boolean', example: true },
      data: { type: 'array', items: {} },
      pagination: { $ref: '#/components/schemas/PaginationMeta' },
      timestamp: { type: 'string', format: 'date-time', example: '2024-01-15T10:30:00Z' },
    },
  },

  // ─── Shared field types ──────────────────────────────────────────────────────

  UUID: {
    type: 'string',
    format: 'uuid',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  },

  ISODate: {
    type: 'string',
    format: 'date',
    example: '2024-01-15',
  },

  ISODateTime: {
    type: 'string',
    format: 'date-time',
    example: '2024-01-15T10:30:00Z',
  },
} as const;
