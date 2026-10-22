/**
 * OpenAPI path definitions for /auth endpoints.
 *
 * Authentication flow:
 *  1. POST /auth/register  — create account, receive JWT + refresh token
 *  2. POST /auth/login     — exchange credentials for JWT + refresh token
 *  3. POST /auth/refresh   — exchange refresh token for new access token
 *  4. POST /auth/logout    — invalidate server-side session (best-effort)
 *
 * All protected endpoints require:
 *   Authorization: Bearer <JWT>
 */

export const authPaths = {
  '/auth/login': {
    post: {
      tags: ['Authentication'],
      summary: 'Login with email and password',
      description:
        'Authenticates a user with email/password credentials. Returns a short-lived JWT access token and a long-lived refresh token. Store both tokens securely (Keychain on iOS, SecureStore on Android).',
      operationId: 'loginUser',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/LoginRequest' },
            examples: {
              petOwner: {
                summary: 'Pet owner login',
                value: { email: 'jane.doe@example.com', password: 'SecurePass123!' },
              },
              vet: {
                summary: 'Veterinarian login',
                value: { email: 'dr.johnson@vetclinic.com', password: 'VetPass456!' },
              },
            },
          },
        },
      },
      responses: {
        '200': {
          description: 'Login successful',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/LoginResponse' },
              example: {
                user: {
                  id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
                  email: 'jane.doe@example.com',
                  name: 'Jane Doe',
                  role: 'owner',
                },
                token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
                refreshToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
                expiresIn: 604800,
              },
            },
          },
        },
        '400': { $ref: '#/components/responses/BadRequest' },
        '401': { $ref: '#/components/responses/Unauthorized' },
        '429': { $ref: '#/components/responses/TooManyRequests' },
        '500': { $ref: '#/components/responses/InternalServerError' },
      },
    },
  },

  '/auth/register': {
    post: {
      tags: ['Authentication'],
      summary: 'Register a new user account',
      description:
        'Creates a new user account. Sends a verification email to the provided address. Returns JWT tokens immediately so the user can start using the app before verifying their email.',
      operationId: 'registerUser',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/RegisterRequest' },
            example: {
              email: 'jane.doe@example.com',
              name: 'Jane Doe',
              password: 'SecurePass123!',
              phone: '+14155552671',
              role: 'owner',
            },
          },
        },
      },
      responses: {
        '201': {
          description: 'Account created successfully',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/RegisterResponse' },
            },
          },
        },
        '400': { $ref: '#/components/responses/BadRequest' },
        '409': {
          description: 'Email already registered',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ApiError' },
              example: {
                success: false,
                error: {
                  code: 'EMAIL_ALREADY_EXISTS',
                  message: 'An account with this email already exists',
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

  '/auth/refresh': {
    post: {
      tags: ['Authentication'],
      summary: 'Refresh access token',
      description:
        'Exchanges a valid refresh token for a new access token. The old refresh token is invalidated. Called automatically by the API client interceptor on 401 responses.',
      operationId: 'refreshToken',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/RefreshTokenRequest' },
          },
        },
      },
      responses: {
        '200': {
          description: 'Token refreshed successfully',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/RefreshTokenResponse' },
            },
          },
        },
        '400': { $ref: '#/components/responses/BadRequest' },
        '401': {
          description: 'Refresh token expired or invalid — user must log in again',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ApiError' },
              example: {
                success: false,
                error: {
                  code: 'REFRESH_TOKEN_EXPIRED',
                  message: 'Session expired — please log in again',
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

  '/auth/logout': {
    post: {
      tags: ['Authentication'],
      summary: 'Logout and invalidate session',
      description:
        'Invalidates the server-side session. The client should also clear locally stored tokens. This is a best-effort call — local token cleanup always proceeds even if this request fails.',
      operationId: 'logoutUser',
      security: [{ BearerAuth: [] }],
      responses: {
        '204': { description: 'Logged out successfully (no content)' },
        '401': { $ref: '#/components/responses/Unauthorized' },
        '500': { $ref: '#/components/responses/InternalServerError' },
      },
    },
  },

  '/auth/verify-email': {
    post: {
      tags: ['Authentication'],
      summary: 'Verify email address',
      description: "Verifies the user's email address using the token sent to their inbox.",
      operationId: 'verifyEmail',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/VerifyEmailRequest' },
          },
        },
      },
      responses: {
        '200': {
          description: 'Email verified successfully',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ApiResponse' },
              example: {
                success: true,
                data: null,
                message: 'Email verified successfully',
                timestamp: '2024-01-15T10:30:00Z',
              },
            },
          },
        },
        '400': { $ref: '#/components/responses/BadRequest' },
        '404': { $ref: '#/components/responses/NotFound' },
        '500': { $ref: '#/components/responses/InternalServerError' },
      },
    },
  },

  '/auth/forgot-password': {
    post: {
      tags: ['Authentication'],
      summary: 'Request password reset email',
      description:
        'Sends a password reset link to the provided email address. Always returns 200 to prevent email enumeration attacks.',
      operationId: 'forgotPassword',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ForgotPasswordRequest' },
          },
        },
      },
      responses: {
        '200': {
          description: 'Reset email sent (or silently ignored if email not found)',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ApiResponse' },
              example: {
                success: true,
                data: null,
                message: 'If that email is registered, a reset link has been sent',
                timestamp: '2024-01-15T10:30:00Z',
              },
            },
          },
        },
        '400': { $ref: '#/components/responses/BadRequest' },
        '429': { $ref: '#/components/responses/TooManyRequests' },
        '500': { $ref: '#/components/responses/InternalServerError' },
      },
    },
  },

  '/auth/reset-password': {
    post: {
      tags: ['Authentication'],
      summary: 'Reset password with token',
      description: "Resets the user's password using the token from the reset email.",
      operationId: 'resetPassword',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ResetPasswordRequest' },
          },
        },
      },
      responses: {
        '200': {
          description: 'Password reset successfully',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ApiResponse' },
            },
          },
        },
        '400': { $ref: '#/components/responses/BadRequest' },
        '404': { $ref: '#/components/responses/NotFound' },
        '500': { $ref: '#/components/responses/InternalServerError' },
      },
    },
  },

  '/auth/oauth/{provider}': {
    post: {
      tags: ['Authentication'],
      summary: 'OAuth login/register via social provider',
      description:
        'Authenticates or registers a user via a social OAuth provider (Google, Apple, Facebook). The client obtains an authorization code from the provider and passes it here.',
      operationId: 'oauthLogin',
      parameters: [
        {
          name: 'provider',
          in: 'path',
          required: true,
          schema: { type: 'string', enum: ['google', 'apple', 'facebook'] },
          example: 'google',
        },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/OAuthCallbackRequest' },
          },
        },
      },
      responses: {
        '200': {
          description: 'OAuth login successful',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/LoginResponse' },
            },
          },
        },
        '400': { $ref: '#/components/responses/BadRequest' },
        '401': { $ref: '#/components/responses/Unauthorized' },
        '500': { $ref: '#/components/responses/InternalServerError' },
      },
    },
  },
} as const;
