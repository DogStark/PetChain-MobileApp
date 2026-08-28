import * as StellarSdk from '@stellar/stellar-sdk';

import { NoteValidationError, noteService, type ClinicalNotePayload } from '../noteService';
import { query } from '../src/db';

jest.mock('../src/db', () => ({
  query: jest.fn(),
}));

const mockedQuery = query as jest.MockedFunction<typeof query>;

describe('noteService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.STELLAR_SOURCE_SECRET = StellarSdk.Keypair.random().secret();
  });

  it('rejects empty SOAP fields', () => {
    const invalidNote = {
      vetId: 'vet-123',
      petId: 'pet-123',
      subjective: '',
      objective: '   ',
      assessment: '',
      plan: ' ',
    } as ClinicalNotePayload;

    expect(() => noteService.validateSoapNotePayload(invalidNote)).toThrow(NoteValidationError);
  });

  it('extracts transaction hash after successful ledger submission', async () => {
    const fakeAccount = {
      accountId: () => 'GTESTACCOUNT123',
      sequenceNumber: () => '1',
      incrementSequenceNumber: jest.fn(),
    } as unknown as StellarSdk.AccountResponse;

    const submitTransaction = jest.fn().mockResolvedValue({ hash: 'TEST_HASH_123' });
    const serverMock = {
      loadAccount: jest.fn().mockResolvedValue(fakeAccount),
      fetchBaseFee: jest.fn().mockResolvedValue('100'),
      submitTransaction,
    } as unknown as StellarSdk.Horizon.Server;

    jest.spyOn(StellarSdk, 'Server').mockImplementation(() => serverMock as any);

    const payload: ClinicalNotePayload = {
      vetId: 'vet-123',
      petId: 'pet-123',
      subjective: 'Patient is alert and responsive.',
      objective: 'Temp 38.2°C, pulse 100, respiratory rate 24.',
      assessment: 'Healthy exam with mild coat dryness.',
      plan: 'Recommend Omega-3 supplements and follow up in 6 weeks.',
    };

    const result = await noteService.anchorClinicalNote('note-123', payload, {
      sourceSecret: process.env.STELLAR_SOURCE_SECRET,
      network: 'testnet',
    });

    expect(result.stellarTxHash).toBe('TEST_HASH_123');
    expect(submitTransaction).toHaveBeenCalledTimes(1);
  });
});
