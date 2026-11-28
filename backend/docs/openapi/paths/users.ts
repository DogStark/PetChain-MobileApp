/**
 * OpenAPI path definitions for /users endpoints.
 *
 * Role-based access:
 *  - GET /users        — admin only
 *  - GET /users/me     — any authenticated user
 *  - GET /users/:id    — admin or self
 *  - PUT /users/:id    — admin or self
 *  - DELETE /users/:id — admin only
 *  - GET /users/:id/export — self only (GDPR Article 20 portability)
 */

export const userPaths = {
  '/users': {
    get: {
      tags: ['Users'],
      summary: 'List all users',
      description: 'Returns a paginated list of users. Requires admin role.',
      operationId: 'listUsers',
      security: [{ BearerAuth: [] }],
      parameters: [
        { $ref: '#/components/parameters/PageParam' },
        { $ref: '#/components/parameters/LimitParam' },
        { $ref: '#/components/parameters/SortByParam' },
        { $ref: '#/components/parameters/SortOrderParam' },
        {
          name: 'role',
          in: 'query',
          schema: { type: 'string', enum: ['owner', 'vet', 'admin'] },
          description: 'Filter by user role',
        },
        {
          name: 'search',
          in: 'query',
          schema: { type: 'string' },
          description: 'Search by name or email (case-insensitive)',
          example: 'jane',
        },
      ],
      responses: {
        '200': {
          description: 'Paginated list of users',
          content: {
            'application/json': {
              schema: {
                allOf: [
                  { $ref: '#/components/schemas/PaginatedResponse' },
                  {
                    properties: {
                      data: { type: 'array', items: { $ref: '#/components/schemas/User' } },
                    },
                  },
                ],
              },
            },
          },
        },
        '401': { $ref: '#/components/responses/Unauthorized' },
        '403': { $ref: '#/components/responses/Forbidden' },
        '500': { $ref: '#/components/responses/InternalServerError' },
      },
    },
  },

  '/users/me': {
    get: {
      tags: ['Users'],
      summary: 'Get current authenticated user',
      description: 'Returns the profile of the currently authenticated user.',
      operationId: 'getCurrentUser',
      security: [{ BearerAuth: [] }],
      responses: {
        '200': {
          description: 'Current user profile',
          content: {
            'application/json': {
              schema: {
                allOf: [
                  { $ref: '#/components/schemas/ApiResponse' },
                  { properties: { data: { $ref: '#/components/schemas/User' } } },
                ],
              },
            },
          },
        },
        '401': { $ref: '#/components/responses/Unauthorized' },
        '500': { $ref: '#/components/responses/InternalServerError' },
      },
    },
  },

  '/users/{id}': {
    get: {
      tags: ['Users'],
      summary: 'Get user by ID',
      description:
        'Returns a user profile by ID. Admins can access any user; regular users can only access their own profile.',
      operationId: 'getUserById',
      security: [{ BearerAuth: [] }],
      parameters: [{ $ref: '#/components/parameters/UserIdParam' }],
      responses: {
        '200': {
          description: 'User profile',
          content: {
            'application/json': {
              schema: {
                allOf: [
                  { $ref: '#/components/schemas/ApiResponse' },
                  { properties: { data: { $ref: '#/components/schemas/User' } } },
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
      tags: ['Users'],
      summary: 'Update user profile',
      description:
        'Updates editable user profile fields. Admins can update any user; regular users can only update their own profile.',
      operationId: 'updateUser',
      security: [{ BearerAuth: [] }],
      parameters: [{ $ref: '#/components/parameters/UserIdParam' }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/UpdateUserRequest' },
            example: { name: 'Jane Smith', phone: '+14155552671' },
          },
        },
      },
      responses: {
        '200': {
          description: 'User updated successfully',
          content: {
            'application/json': {
              schema: {
                allOf: [
                  { $ref: '#/components/schemas/ApiResponse' },
                  { properties: { data: { $ref: '#/components/schemas/UpdateUserResponse' } } },
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
      tags: ['Users'],
      summary: 'Delete user account',
      description: 'Permanently deletes a user account. Requires admin role.',
      operationId: 'deleteUser',
      security: [{ BearerAuth: [] }],
      parameters: [{ $ref: '#/components/parameters/UserIdParam' }],
      responses: {
        '204': { description: 'User deleted successfully (no content)' },
        '401': { $ref: '#/components/responses/Unauthorized' },
        '403': { $ref: '#/components/responses/Forbidden' },
        '404': { $ref: '#/components/responses/NotFound' },
        '500': { $ref: '#/components/responses/InternalServerError' },
      },
    },
  },

  '/users/{id}/export': {
    get: {
      tags: ['Users'],
      summary: 'Export user data (GDPR Article 20)',
      description:
        'Exports the authenticated user\'s own data as a ZIP archive containing JSON files for pets, medical records, appointments and medications (plus PDF pet summaries). Small exports are returned directly as `application/zip`; large exports are generated asynchronously and return `202` with a request id, with a signed download URL delivered by email. Every export is recorded in the HIPAA audit trail.',
      operationId: 'exportUserData',
      security: [{ BearerAuth: [] }],
      parameters: [{ $ref: '#/components/parameters/UserIdParam' }],
      responses: {
        '200': {
          description: 'ZIP archive with the user\'s exported data',
          content: {
            'application/zip': {
              schema: { type: 'string', format: 'binary' },
            },
          },
        },
        '202': {
          description: 'Large export queued for asynchronous generation',
          content: {
            'application/json': {
              schema: {
                allOf: [
                  { $ref: '#/components/schemas/ApiResponse' },
                  {
                    properties: {
                      data: {
                        type: 'object',
                        properties: {
                          requestId: { type: 'string' },
                          status: {
                            type: 'string',
                            enum: ['pending', 'processing', 'completed', 'failed'],
                          },
                          requestedAt: { type: 'string', format: 'date-time' },
                          statusUrl: { type: 'string' },
                          message: { type: 'string' },
                        },
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

  '/users/export/{requestId}': {
    get: {
      tags: ['Users'],
      summary: 'Get data export request status',
      description:
        'Returns the status of an asynchronous data export request owned by the authenticated user, including a signed download URL once completed.',
      operationId: 'getUserDataExportStatus',
      security: [{ BearerAuth: [] }],
      parameters: [
        {
          name: 'requestId',
          in: 'path',
          required: true,
          schema: { type: 'string' },
          description: 'Export request identifier',
        },
      ],
      responses: {
        '200': {
          description: 'Export request status',
          content: {
            'application/json': {
              schema: {
                allOf: [
                  { $ref: '#/components/schemas/ApiResponse' },
                  {
                    properties: {
                      data: {
                        type: 'object',
                        properties: {
                          id: { type: 'string' },
                          userId: { type: 'string' },
                          status: {
                            type: 'string',
                            enum: ['pending', 'processing', 'completed', 'failed'],
                          },
                          requestedAt: { type: 'string', format: 'date-time' },
                          completedAt: { type: 'string', format: 'date-time' },
                          downloadUrl: { type: 'string' },
                          expiresAt: { type: 'string', format: 'date-time' },
                          error: { type: 'string' },
                        },
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

  '/users/export/{requestId}/download': {
    get: {
      tags: ['Users'],
      summary: 'Download a completed data export',
      description:
        'Streams the ZIP archive for a completed export request. Requires the signed `token` and `expires` query parameters issued with the download URL.',
      operationId: 'downloadUserDataExport',
      security: [{ BearerAuth: [] }],
      parameters: [
        {
          name: 'requestId',
          in: 'path',
          required: true,
          schema: { type: 'string' },
          description: 'Export request identifier',
        },
        {
          name: 'expires',
          in: 'query',
          required: true,
          schema: { type: 'string', format: 'date-time' },
          description: 'Signed URL expiry timestamp',
        },
        {
          name: 'token',
          in: 'query',
          required: true,
          schema: { type: 'string' },
          description: 'HMAC signature for the download URL',
        },
      ],
      responses: {
        '200': {
          description: 'ZIP archive with the exported data',
          content: {
            'application/zip': {
              schema: { type: 'string', format: 'binary' },
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
