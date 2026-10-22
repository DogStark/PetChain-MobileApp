/**
 * OpenAPI path definitions for /blockchain endpoints.
 *
 * The blockchain layer anchors medical record hashes on the Stellar network.
 * This provides tamper-proof verification — any modification to a record
 * will produce a different hash that won't match the on-chain value.
 *
 * Hash algorithm: SHA-256 over canonical JSON (keys sorted alphabetically,
 * blockchain metadata fields excluded to prevent circular hashing).
 */

export const blockchainPaths = {
  '/blockchain/records/store': {
    post: {
      tags: ['Blockchain'],
      summary: 'Anchor a record hash on Stellar',
      description:
        'Stores a SHA-256 hash of a medical record on the Stellar blockchain. The hash is embedded in a Stellar transaction memo field. Returns the transaction details once confirmed.',
      operationId: 'storeRecordOnChain',
      security: [{ BearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/StoreRecordRequest' },
            example: {
              recordId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
              hash: 'a3f5c8d2e1b4f7a9c2d5e8f1b4c7d0e3f6a9b2c5d8e1f4a7b0c3d6e9f2a5b8',
              metadata: {
                petId: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
                recordType: 'vaccination',
              },
            },
          },
        },
      },
      responses: {
        '201': {
          description: 'Hash anchored on Stellar successfully',
          content: {
            'application/json': {
              schema: {
                allOf: [
                  { $ref: '#/components/schemas/ApiResponse' },
                  {
                    properties: {
                      data: { $ref: '#/components/schemas/StellarTransactionDetails' },
                    },
                  },
                ],
              },
            },
          },
        },
        '400': { $ref: '#/components/responses/BadRequest' },
        '401': { $ref: '#/components/responses/Unauthorized' },
        '408': {
          description: 'Blockchain request timed out',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
        },
        '429': { $ref: '#/components/responses/TooManyRequests' },
        '500': { $ref: '#/components/responses/InternalServerError' },
        '503': {
          description: 'Stellar network temporarily unavailable',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ApiError' },
              example: {
                success: false,
                error: {
                  code: 'SERVICE_UNAVAILABLE',
                  message: 'Blockchain service is temporarily unavailable',
                },
                timestamp: '2024-01-15T10:30:00Z',
              },
            },
          },
        },
      },
    },
  },

  '/blockchain/records/verify': {
    post: {
      tags: ['Blockchain'],
      summary: 'Verify a record hash against Stellar',
      description:
        'Verifies that a given SHA-256 hash matches the hash anchored on the Stellar blockchain for the specified record. Returns `verified: true` if the hashes match (record is untampered).',
      operationId: 'verifyRecordOnChain',
      security: [{ BearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/VerifyRecordRequest' },
            example: {
              recordId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
              hash: 'a3f5c8d2e1b4f7a9c2d5e8f1b4c7d0e3f6a9b2c5d8e1f4a7b0c3d6e9f2a5b8',
            },
          },
        },
      },
      responses: {
        '200': {
          description: 'Verification result',
          content: {
            'application/json': {
              schema: {
                allOf: [
                  { $ref: '#/components/schemas/ApiResponse' },
                  {
                    properties: {
                      data: { $ref: '#/components/schemas/StellarRecordVerification' },
                    },
                  },
                ],
              },
              examples: {
                verified: {
                  summary: 'Record is authentic',
                  value: {
                    success: true,
                    data: {
                      verified: true,
                      recordId: 'a1b2c3d4-...',
                      onChainHash: 'a3f5c8d2...',
                      txHash: 'stellar-tx-...',
                      ledger: 48234567,
                    },
                    timestamp: '2024-01-15T10:30:00Z',
                  },
                },
                tampered: {
                  summary: 'Record has been tampered with',
                  value: {
                    success: true,
                    data: {
                      verified: false,
                      recordId: 'a1b2c3d4-...',
                      onChainHash: 'a3f5c8d2...',
                      txHash: 'stellar-tx-...',
                    },
                    timestamp: '2024-01-15T10:30:00Z',
                  },
                },
              },
            },
          },
        },
        '400': { $ref: '#/components/responses/BadRequest' },
        '401': { $ref: '#/components/responses/Unauthorized' },
        '404': {
          description: 'Record not found on blockchain',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
        },
        '500': { $ref: '#/components/responses/InternalServerError' },
      },
    },
  },

  '/blockchain/records/batch-verify': {
    post: {
      tags: ['Blockchain'],
      summary: 'Batch verify multiple record hashes',
      description:
        'Verifies up to 50 record hashes in a single request. Useful for bulk integrity checks.',
      operationId: 'batchVerifyRecords',
      security: [{ BearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/BatchVerifyRequest' },
            example: {
              records: [
                { recordId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', hash: 'a3f5c8d2...' },
                { recordId: 'b2c3d4e5-f6a7-8901-bcde-f12345678901', hash: 'b4e6d0f2...' },
              ],
            },
          },
        },
      },
      responses: {
        '200': {
          description: 'Batch verification results',
          content: {
            'application/json': {
              schema: {
                allOf: [
                  { $ref: '#/components/schemas/ApiResponse' },
                  {
                    properties: {
                      data: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/StellarRecordVerification' },
                      },
                    },
                  },
                ],
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

  '/blockchain/records/{id}/hash': {
    get: {
      tags: ['Blockchain'],
      summary: 'Retrieve anchored hash for a record',
      description:
        'Fetches the hash and transaction details that were anchored on Stellar for a specific record.',
      operationId: 'retrieveRecordHash',
      security: [{ BearerAuth: [] }],
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' },
          description: 'Medical record ID',
          example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        },
      ],
      responses: {
        '200': {
          description: 'Anchored hash details',
          content: {
            'application/json': {
              schema: {
                allOf: [
                  { $ref: '#/components/schemas/ApiResponse' },
                  {
                    properties: {
                      data: { $ref: '#/components/schemas/RetrieveRecordHashResponse' },
                    },
                  },
                ],
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

  '/blockchain/transactions/{txHash}': {
    get: {
      tags: ['Blockchain'],
      summary: 'Get Stellar transaction details',
      description: 'Fetches full details of a Stellar transaction by its hash.',
      operationId: 'getTransactionDetails',
      security: [{ BearerAuth: [] }],
      parameters: [
        {
          name: 'txHash',
          in: 'path',
          required: true,
          schema: { type: 'string' },
          description: 'Stellar transaction hash (64-char hex)',
          example: 'a3f5c8d2e1b4f7a9c2d5e8f1b4c7d0e3f6a9b2c5d8e1f4a7b0c3d6e9f2a5b8',
        },
      ],
      responses: {
        '200': {
          description: 'Transaction details',
          content: {
            'application/json': {
              schema: {
                allOf: [
                  { $ref: '#/components/schemas/ApiResponse' },
                  {
                    properties: {
                      data: { $ref: '#/components/schemas/StellarTransactionDetails' },
                    },
                  },
                ],
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

  '/blockchain/transactions/history': {
    get: {
      tags: ['Blockchain'],
      summary: 'Get transaction history',
      description: 'Returns Stellar transaction history, optionally filtered by record or account.',
      operationId: 'getTransactionHistory',
      security: [{ BearerAuth: [] }],
      parameters: [
        {
          name: 'recordId',
          in: 'query',
          schema: { type: 'string', format: 'uuid' },
          description: 'Filter by medical record ID',
        },
        {
          name: 'accountId',
          in: 'query',
          schema: { type: 'string' },
          description: 'Filter by Stellar account ID',
        },
        {
          name: 'limit',
          in: 'query',
          schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
          description: 'Maximum number of transactions to return',
        },
      ],
      responses: {
        '200': {
          description: 'Transaction history',
          content: {
            'application/json': {
              schema: {
                allOf: [
                  { $ref: '#/components/schemas/ApiResponse' },
                  {
                    properties: {
                      data: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/StellarTransactionDetails' },
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
  },

  '/blockchain/network/info': {
    get: {
      tags: ['Blockchain'],
      summary: 'Get Stellar network info',
      description: 'Returns current Stellar network status including the active ledger number.',
      operationId: 'getStellarNetworkInfo',
      security: [{ BearerAuth: [] }],
      responses: {
        '200': {
          description: 'Stellar network information',
          content: {
            'application/json': {
              schema: {
                allOf: [
                  { $ref: '#/components/schemas/ApiResponse' },
                  { properties: { data: { $ref: '#/components/schemas/NetworkInfoResponse' } } },
                ],
              },
              example: {
                success: true,
                data: {
                  network: 'mainnet',
                  horizonUrl: 'https://horizon.stellar.org',
                  passphrase: 'Public Global Stellar Network ; September 2015',
                  currentLedger: 48234567,
                  latestLedger: 48234570,
                },
                timestamp: '2024-01-15T10:30:00Z',
              },
            },
          },
        },
        '401': { $ref: '#/components/responses/Unauthorized' },
        '503': {
          description: 'Stellar network unavailable',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
        },
        '500': { $ref: '#/components/responses/InternalServerError' },
      },
    },
  },
} as const;
