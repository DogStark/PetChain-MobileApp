/**
 * OpenAPI schema definitions for Authentication endpoints.
 */

export const authSchemas = {
  // ─── Request bodies ──────────────────────────────────────────────────────────

  LoginRequest: {
    type: 'object',
    required: ['email', 'password'],
    properties: {
      email: {
        type: 'string',
        format: 'email',
        example: 'jane.doe@example.com',
        description: 'Registered user email address',
      },
      password: {
        type: 'string',
        format: 'password',
        minLength: 8,
        example: 'SecurePass123!',
        description: 'User password (min 8 chars, must include upper, lower, number, special)',
      },
    },
  },

  RegisterRequest: {
    type: 'object',
    required: ['email', 'name', 'password'],
    properties: {
      email: {
        type: 'string',
        format: 'email',
        example: 'jane.doe@example.com',
      },
      name: {
        type: 'string',
        minLength: 2,
        maxLength: 100,
        example: 'Jane Doe',
      },
      password: {
        type: 'string',
        format: 'password',
        minLength: 8,
        maxLength: 128,
        example: 'SecurePass123!',
        description: 'Must include uppercase, lowercase, number, and special character',
      },
      phone: {
        type: 'string',
        example: '+14155552671',
        description: 'E.164 format phone number (optional)',
      },
      role: {
        type: 'string',
        enum: ['owner', 'vet', 'admin'],
        default: 'owner',
        example: 'owner',
      },
    },
  },

  RefreshTokenRequest: {
    type: 'object',
    required: ['refreshToken'],
    properties: {
      refreshToken: {
        type: 'string',
        example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
        description: 'The refresh token issued at login',
      },
    },
  },

  ForgotPasswordRequest: {
    type: 'object',
    required: ['email'],
    properties: {
      email: {
        type: 'string',
        format: 'email',
        example: 'jane.doe@example.com',
      },
    },
  },

  ResetPasswordRequest: {
    type: 'object',
    required: ['token', 'newPassword'],
    properties: {
      token: {
        type: 'string',
        example: 'reset-token-abc123',
        description: 'Password reset token received via email',
      },
      newPassword: {
        type: 'string',
        format: 'password',
        minLength: 8,
        maxLength: 128,
        example: 'NewSecurePass456!',
      },
    },
  },

  VerifyEmailRequest: {
    type: 'object',
    required: ['token'],
    properties: {
      token: {
        type: 'string',
        example: 'verify-token-xyz789',
        description: 'Email verification token received via email',
      },
    },
  },

  OAuthCallbackRequest: {
    type: 'object',
    required: ['code'],
    properties: {
      code: {
        type: 'string',
        example: 'oauth-authorization-code',
        description: 'OAuth 2.0 authorization code from the provider',
      },
      redirectUri: {
        type: 'string',
        format: 'uri',
        example: 'petchain://auth/callback',
      },
    },
  },

  // ─── Response bodies ─────────────────────────────────────────────────────────

  AuthUserSummary: {
    type: 'object',
    required: ['id', 'email', 'name', 'role'],
    properties: {
      id: { $ref: '#/components/schemas/UUID' },
      email: { type: 'string', format: 'email', example: 'jane.doe@example.com' },
      name: { type: 'string', example: 'Jane Doe' },
      role: { type: 'string', enum: ['owner', 'vet', 'admin'], example: 'owner' },
    },
  },

  LoginResponse: {
    type: 'object',
    required: ['user', 'token', 'expiresIn'],
    properties: {
      user: { $ref: '#/components/schemas/AuthUserSummary' },
      token: {
        type: 'string',
        example:
          'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLWlkIiwiZXhwIjoxNzA5MDAwMDAwfQ.signature',
        description: 'JWT access token — include as Authorization: Bearer {token}',
      },
      refreshToken: {
        type: 'string',
        example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
        description: 'Long-lived refresh token for obtaining new access tokens',
      },
      expiresIn: {
        type: 'integer',
        example: 604800,
        description: 'Access token lifetime in seconds (default: 7 days)',
      },
    },
  },

  RegisterResponse: {
    type: 'object',
    required: ['user', 'token'],
    properties: {
      user: { $ref: '#/components/schemas/AuthUserSummary' },
      token: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' },
      refreshToken: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' },
    },
  },

  RefreshTokenResponse: {
    type: 'object',
    required: ['token', 'expiresIn'],
    properties: {
      token: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' },
      refreshToken: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' },
      expiresIn: { type: 'integer', example: 604800 },
    },
  },
} as const;
