import {
  TurnCredentialManager,
  areCredentialsExpired,
  credentialsNeedRefresh,
  issueTurnCredentials,
  verifyTurnCredential,
} from '../turnCredentialService';

const SECRET = 'test-shared-secret-do-not-use-in-prod';
const URLS = ['turn:relay.example.test:3478?transport=udp'];

describe('turnCredentialService', () => {
  it('issues ephemeral credentials with an embedded expiry', () => {
    const creds = issueTurnCredentials({
      principal: 'user-123',
      sharedSecret: SECRET,
      urls: URLS,
      ttlSeconds: 300,
      nowSeconds: 1_000,
    });

    expect(creds.username).toBe('1300:user-123');
    expect(creds.expiresAt).toBe(1_300);
    expect(creds.ttl).toBe(300);
    expect(creds.credential).toEqual(expect.any(String));
  });

  it('clamps absurd TTLs and strips separator characters from the principal', () => {
    const creds = issueTurnCredentials({
      principal: 'ab:cd ef',
      sharedSecret: SECRET,
      urls: URLS,
      ttlSeconds: 5,
      nowSeconds: 0,
    });
    expect(creds.ttl).toBe(30);
    expect(creds.username).toBe('30:ab_cd_ef');
  });

  it('verifies a valid credential and rejects tampering / expiry', () => {
    const creds = issueTurnCredentials({
      principal: 'user-1',
      sharedSecret: SECRET,
      urls: URLS,
      nowSeconds: 1_000,
    });

    expect(verifyTurnCredential(creds.username, creds.credential, { current: SECRET }, 1_100)).toBe(
      true,
    );
    expect(verifyTurnCredential(creds.username, 'forged', { current: SECRET }, 1_100)).toBe(false);
    expect(
      verifyTurnCredential(creds.username, creds.credential, { current: SECRET }, 999_999),
    ).toBe(false);
  });

  it('accepts the previous secret during a rotation grace window', () => {
    const oldSecret = SECRET;
    const newSecret = 'rotated-secret';
    const creds = issueTurnCredentials({
      principal: 'user-1',
      sharedSecret: oldSecret,
      urls: URLS,
      nowSeconds: 1_000,
    });

    expect(
      verifyTurnCredential(
        creds.username,
        creds.credential,
        { current: newSecret, previous: oldSecret },
        1_100,
      ),
    ).toBe(true);
    // once the grace window drops the old secret the credential is dead
    expect(
      verifyTurnCredential(creds.username, creds.credential, { current: newSecret }, 1_100),
    ).toBe(false);
  });

  it('flags refresh before expiry and expiry after the deadline', () => {
    const creds = { expiresAt: 1_300 };
    expect(credentialsNeedRefresh(creds, 1_000)).toBe(false);
    expect(credentialsNeedRefresh(creds, 1_250)).toBe(true);
    expect(areCredentialsExpired(creds, 1_299)).toBe(false);
    expect(areCredentialsExpired(creds, 1_300)).toBe(true);
  });

  describe('TurnCredentialManager', () => {
    it('caches, refreshes near expiry, and recovers an expired session', async () => {
      let clock = 1_000;
      let issued = 0;
      const manager = new TurnCredentialManager(
        async () => {
          issued += 1;
          return issueTurnCredentials({
            principal: `user-${issued}`,
            sharedSecret: SECRET,
            urls: URLS,
            ttlSeconds: 300,
            nowSeconds: clock,
          });
        },
        () => clock,
      );

      const first = await manager.getCredentials();
      expect(issued).toBe(1);

      // still fresh -> served from cache
      clock = 1_100;
      expect(await manager.getCredentials()).toBe(first);
      expect(issued).toBe(1);

      // within refresh skew -> re-issued
      clock = 1_250;
      const second = await manager.getCredentials();
      expect(issued).toBe(2);
      expect(second).not.toBe(first);

      // relay rejected the session -> forced recovery
      clock = 1_400;
      const recovered = await manager.recoverExpiredSession();
      expect(issued).toBe(3);
      expect(recovered.expiresAt).toBe(1_700);
    });

    it('coalesces concurrent fetches into one request', async () => {
      let issued = 0;
      const manager = new TurnCredentialManager(async () => {
        issued += 1;
        await new Promise((r) => setTimeout(r, 5));
        return issueTurnCredentials({
          principal: 'user',
          sharedSecret: SECRET,
          urls: URLS,
          nowSeconds: 0,
        });
      });

      await Promise.all([manager.getCredentials(), manager.getCredentials(), manager.getCredentials()]);
      expect(issued).toBe(1);
    });
  });
});
