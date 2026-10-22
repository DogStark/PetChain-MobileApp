/**
 * OpenAPI schema definitions for Blockchain (Stellar) endpoints.
 */

export const blockchainSchemas = {
  StellarTransactionDetails: {
    type: 'object',
    required: ['hash', 'successful'],
    properties: {
      hash: {
        type: 'string',
        example: 'a3f5c8d2e1b4f7a9c2d5e8f1b4c7d0e3f6a9b2c5d8e1f4a7b0c3d6e9f2a5b8',
        description: 'Stellar transaction hash (64-char hex)',
      },
      successful: { type: 'boolean', example: true },
      ledger: { type: 'integer', example: 48234567 },
      createdAt: { $ref: '#/components/schemas/ISODateTime' },
      sourceAccount: {
        type: 'string',
        example: 'GABC...XYZ',
        description: 'Stellar account that submitted the transaction',
      },
      feeCharged: {
        type: 'string',
        example: '100',
        description: 'Fee in stroops (1 XLM = 10,000,000 stroops)',
      },
      memo: { type: 'string', example: 'petchain:record:abc123' },
      operationCount: { type: 'integer', example: 1 },
    },
  },

  StellarRecordVerification: {
    type: 'object',
    required: ['verified', 'recordId'],
    properties: {
      verified: {
        type: 'boolean',
        example: true,
        description: 'True if the submitted hash matches the on-chain anchored hash',
      },
      recordId: { $ref: '#/components/schemas/UUID' },
      onChainHash: {
        type: 'string',
        example: 'a3f5c8d2e1b4f7a9...',
        description: 'The hash stored on the Stellar blockchain',
      },
      txHash: { type: 'string', example: 'stellar-tx-hash-abc123' },
      ledger: { type: 'integer', example: 48234567 },
      timestamp: { $ref: '#/components/schemas/ISODateTime' },
    },
  },

  StoreRecordRequest: {
    type: 'object',
    required: ['recordId', 'hash'],
    properties: {
      recordId: { $ref: '#/components/schemas/UUID' },
      hash: {
        type: 'string',
        pattern: '^[a-f0-9]{64}$',
        example: 'a3f5c8d2e1b4f7a9c2d5e8f1b4c7d0e3f6a9b2c5d8e1f4a7b0c3d6e9f2a5b8',
        description: 'SHA-256 hex hash of the medical record payload',
      },
      metadata: {
        type: 'object',
        additionalProperties: true,
        example: { petId: 'uuid', vetId: 'uuid', recordType: 'vaccination' },
        description: 'Optional metadata to anchor alongside the hash',
      },
    },
  },

  VerifyRecordRequest: {
    type: 'object',
    required: ['recordId', 'hash'],
    properties: {
      recordId: { $ref: '#/components/schemas/UUID' },
      hash: {
        type: 'string',
        pattern: '^[a-f0-9]{64}$',
        example: 'a3f5c8d2e1b4f7a9c2d5e8f1b4c7d0e3f6a9b2c5d8e1f4a7b0c3d6e9f2a5b8',
        description: 'SHA-256 hash to verify against the on-chain record',
      },
    },
  },

  RetrieveRecordHashResponse: {
    type: 'object',
    required: ['hash', 'txHash', 'timestamp'],
    properties: {
      hash: { type: 'string', example: 'a3f5c8d2e1b4f7a9...' },
      txHash: { type: 'string', example: 'stellar-tx-hash-abc123' },
      timestamp: { $ref: '#/components/schemas/ISODateTime' },
      ledger: { type: 'integer', example: 48234567 },
    },
  },

  BatchVerifyRequest: {
    type: 'object',
    required: ['records'],
    properties: {
      records: {
        type: 'array',
        minItems: 1,
        maxItems: 50,
        items: {
          type: 'object',
          required: ['recordId', 'hash'],
          properties: {
            recordId: { $ref: '#/components/schemas/UUID' },
            hash: {
              type: 'string',
              pattern: '^[a-f0-9]{64}$',
              example: 'a3f5c8d2e1b4f7a9...',
            },
          },
        },
        description: 'Array of record ID + hash pairs to verify (max 50)',
      },
    },
  },

  NetworkInfoResponse: {
    type: 'object',
    required: ['network', 'horizonUrl', 'passphrase', 'currentLedger', 'latestLedger'],
    properties: {
      network: {
        type: 'string',
        enum: ['mainnet', 'testnet'],
        example: 'mainnet',
      },
      horizonUrl: {
        type: 'string',
        format: 'uri',
        example: 'https://horizon.stellar.org',
      },
      passphrase: {
        type: 'string',
        example: 'Public Global Stellar Network ; September 2015',
      },
      currentLedger: { type: 'integer', example: 48234567 },
      latestLedger: { type: 'integer', example: 48234570 },
    },
  },
} as const;
