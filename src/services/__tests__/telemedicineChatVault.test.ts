import { InMemoryStore, TelemedicineChatVault, type ChatMessage } from '../telemedicineChatVault';

const messages = (accountTag: string): ChatMessage[] => [
  {
    id: `${accountTag}-1`,
    threadId: 't1',
    senderId: 'vet-9',
    body: `synthetic note for ${accountTag}`,
    sentAt: '2026-01-01T00:00:00.000Z',
    attachments: [{ id: 'a1', name: 'xray.png', contentType: 'image/png', sizeBytes: 2048 }],
  },
];

describe('TelemedicineChatVault', () => {
  let keystore: InMemoryStore;
  let cache: InMemoryStore;
  let vault: TelemedicineChatVault;

  beforeEach(() => {
    keystore = new InMemoryStore();
    cache = new InMemoryStore();
    vault = new TelemedicineChatVault(keystore, cache);
  });

  it('round-trips encrypted history for an account', async () => {
    await vault.saveHistory('acct-a', messages('a'));
    expect(await vault.readHistory('acct-a')).toEqual(messages('a'));
  });

  it('stores ciphertext, not plaintext, in the cache', async () => {
    await vault.saveHistory('acct-a', messages('a'));
    const raw = (await cache.keys()).map((k) => cache.getItemAsync(k));
    const values = await Promise.all(raw);
    expect(values.join('')).not.toContain('synthetic note');
  });

  it('returns [] and never leaks the previous account after logout', async () => {
    await vault.saveHistory('acct-a', messages('a'));
    await vault.logout('acct-a');

    expect(await vault.readHistory('acct-a')).toEqual([]);
    // even a leftover ciphertext row cannot be read once the key is gone
    await cache.setItemAsync('telemedicine.chatHistory.acct-a', 'garbage');
    expect(await vault.readHistory('acct-a')).toEqual([]);
  });

  it('isolates accounts across an account switch', async () => {
    await vault.saveHistory('acct-a', messages('a'));
    await vault.switchAccount('acct-a', 'acct-b');

    expect(await vault.readHistory('acct-a')).toEqual([]);
    expect(await vault.readHistory('acct-b')).toEqual([]);

    await vault.saveHistory('acct-b', messages('b'));
    expect(await vault.readHistory('acct-b')).toEqual(messages('b'));
    expect(await vault.readHistory('acct-a')).toEqual([]);
  });

  it('purges the key before the cache so an interrupted purge still fails closed', async () => {
    await vault.saveHistory('acct-a', messages('a'));
    const failingCache = new InMemoryStore();
    await failingCache.setItemAsync(
      'telemedicine.chatHistory.acct-a',
      (await cache.getItemAsync('telemedicine.chatHistory.acct-a')) as string,
    );
    failingCache.delete = async () => {
      throw new Error('storage unavailable');
    };
    const partialVault = new TelemedicineChatVault(keystore, failingCache);

    await expect(partialVault.purgeAccount('acct-a')).rejects.toThrow('storage unavailable');
    // key was destroyed first -> history is unreadable regardless
    expect(await partialVault.readHistory('acct-a')).toEqual([]);
  });

  it('is idempotent for repeated logout calls', async () => {
    await vault.saveHistory('acct-a', messages('a'));
    await vault.logout('acct-a');
    await expect(vault.logout('acct-a')).resolves.toBeUndefined();
  });
});
