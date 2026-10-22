import * as StellarSdk from '@stellar/stellar-sdk';
import * as SecureStore from 'expo-secure-store';

jest.mock('expo-secure-store');
jest.mock('@stellar/stellar-sdk');

describe('stellarAccountService', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('derives public key from stored secret', async () => {
    const mockSecret = 'SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(mockSecret);

    const fakeKP = { publicKey: () => 'GPUBLICKEYEXAMPLE' };
    (StellarSdk.Keypair.fromSecret as unknown as jest.Mock).mockReturnValue(fakeKP);

    const { getPublicKeyFromStoredSecret } = await import('../stellarAccountService');
    const pk = await getPublicKeyFromStoredSecret();
    expect(pk).toBe('GPUBLICKEYEXAMPLE');
  });

  it('fundTestnet calls friendbot and returns success', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
    const { fundTestnet } = await import('../stellarAccountService');
    const res = await fundTestnet('GABC');
    expect(res.success).toBe(true);
  });
});
