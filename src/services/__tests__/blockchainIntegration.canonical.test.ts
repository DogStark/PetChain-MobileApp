/**
 * #955 — on-chain medical commitments must use a deterministic, versioned,
 * domain-separated pre-image so the mobile app, backend, and Soroban contract
 * tests all derive the same hash.
 *
 * The golden vectors below are the shared contract: any change to them must be
 * mirrored in the contract test-suite and paired with a version bump.
 */
import {
  MEDICAL_COMMITMENT_DOMAIN,
  MEDICAL_COMMITMENT_VERSION,
  canonicalizeMedicalCommitment,
  hashMedicalCommitment,
  verifyMedicalCommitment,
  type MedicalCommitment,
} from '../blockchainIntegration';

const VECTOR_A: MedicalCommitment = {
  recordId: 'rec_001',
  petId: 'pet_abc',
  payloadHash: 'a'.repeat(64),
  issuedAt: 1735689600000,
  issuer: 'GABC123',
};

const VECTOR_B: MedicalCommitment = {
  recordId: 'rec_002',
  petId: 'pet_xyz',
  payloadHash: 'deadbeef'.repeat(8),
  issuedAt: 0,
  issuer: 'GXYZ',
};

const GOLDEN = {
  a: {
    canonical:
      '{"domain":"petchain.medical.commitment","fields":{"issuedAt":1735689600000,"issuer":"GABC123","payloadHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","petId":"pet_abc","recordId":"rec_001"},"version":1}',
    sha256: '87dce2b771b56cdb0c57a67872a882724dfccf57cc24faf80a0cd70c280eb0c3',
  },
  b: {
    canonical:
      '{"domain":"petchain.medical.commitment","fields":{"issuedAt":0,"issuer":"GXYZ","payloadHash":"deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef","petId":"pet_xyz","recordId":"rec_002"},"version":1}',
    sha256: '4c0214f74ccdce3287e7f0846d861bf761fd008429cec210fed278845bc91e8f',
  },
};

describe('canonicalizeMedicalCommitment — golden vectors', () => {
  it('exposes a stable domain tag and version', () => {
    expect(MEDICAL_COMMITMENT_DOMAIN).toBe('petchain.medical.commitment');
    expect(MEDICAL_COMMITMENT_VERSION).toBe(1);
  });

  it('matches the golden canonical pre-image', () => {
    expect(canonicalizeMedicalCommitment(VECTOR_A)).toBe(GOLDEN.a.canonical);
    expect(canonicalizeMedicalCommitment(VECTOR_B)).toBe(GOLDEN.b.canonical);
  });

  it('matches the golden SHA-256 digest', () => {
    expect(hashMedicalCommitment(VECTOR_A)).toBe(GOLDEN.a.sha256);
    expect(hashMedicalCommitment(VECTOR_B)).toBe(GOLDEN.b.sha256);
  });
});

describe('determinism', () => {
  it('is independent of input key order', () => {
    const shuffled: MedicalCommitment = {
      issuer: VECTOR_A.issuer,
      issuedAt: VECTOR_A.issuedAt,
      recordId: VECTOR_A.recordId,
      payloadHash: VECTOR_A.payloadHash,
      petId: VECTOR_A.petId,
    };
    expect(hashMedicalCommitment(shuffled)).toBe(GOLDEN.a.sha256);
  });

  it('normalises payloadHash case and unicode form', () => {
    expect(
      hashMedicalCommitment({ ...VECTOR_A, payloadHash: 'A'.repeat(64) }),
    ).toBe(GOLDEN.a.sha256);
  });

  it('changes the digest when any field changes', () => {
    expect(hashMedicalCommitment({ ...VECTOR_A, issuedAt: VECTOR_A.issuedAt + 1 })).not.toBe(
      GOLDEN.a.sha256,
    );
  });
});

describe('validation', () => {
  it('rejects a malformed payload hash', () => {
    expect(() => canonicalizeMedicalCommitment({ ...VECTOR_A, payloadHash: 'xyz' })).toThrow();
  });

  it('rejects a non-integer / negative issuedAt', () => {
    expect(() => canonicalizeMedicalCommitment({ ...VECTOR_A, issuedAt: -1 })).toThrow();
    expect(() => canonicalizeMedicalCommitment({ ...VECTOR_A, issuedAt: 1.5 })).toThrow();
  });

  it('rejects missing identifiers', () => {
    expect(() => canonicalizeMedicalCommitment({ ...VECTOR_A, recordId: '' })).toThrow();
  });
});

describe('verifyMedicalCommitment', () => {
  it('accepts a correct digest (any case)', () => {
    expect(verifyMedicalCommitment(VECTOR_A, GOLDEN.a.sha256)).toBe(true);
    expect(verifyMedicalCommitment(VECTOR_A, GOLDEN.a.sha256.toUpperCase())).toBe(true);
  });

  it('rejects a wrong or truncated digest', () => {
    expect(verifyMedicalCommitment(VECTOR_A, GOLDEN.b.sha256)).toBe(false);
    expect(verifyMedicalCommitment(VECTOR_A, 'abcd')).toBe(false);
  });
});
