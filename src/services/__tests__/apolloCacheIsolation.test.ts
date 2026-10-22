/**
 * #978 — Prevent GraphQL cache leakage between accounts.
 *
 * Characterizes the leak first: without an explicit reset, the normalized
 * InMemoryCache hands a second account the first account's pet on a
 * cache-first read. Then verifies `resetApolloStore()` closes it, on both a
 * warm (data present) and cold (already empty) cache — the latter matters for
 * the offline path where logout runs with nothing cached.
 */
import { gql, InMemoryCache, ApolloClient } from '@apollo/client';

const PET_QUERY = gql`
  query Pet($id: ID!) {
    pet(id: $id) {
      id
      name
    }
  }
`;

jest.mock('graphql-ws', () => ({ createClient: () => ({ dispose: jest.fn() }) }));
jest.mock('@apollo/client/link/subscriptions', () => ({
  GraphQLWsLink: class {
    request() {
      return null;
    }
  },
}));

describe('#978 GraphQL cache isolation between accounts', () => {
  it('reproduces the leak: a shared normalized cache exposes the prior account pet', () => {
    const cache = new InMemoryCache();
    cache.writeQuery({
      query: PET_QUERY,
      variables: { id: 'pet-1' },
      data: { pet: { __typename: 'Pet', id: 'pet-1', name: 'Account A Dog' } },
    });

    // Account B logs in, cache is NOT reset — cache-first read leaks A's pet.
    const leaked = cache.readQuery({ query: PET_QUERY, variables: { id: 'pet-1' } });
    expect(leaked).toEqual({ pet: { __typename: 'Pet', id: 'pet-1', name: 'Account A Dog' } });
  });

  it('resetApolloStore() wipes normalized state atomically', async () => {
    const { resetApolloStore } = await import('../apolloClient');
    const mod = await import('../apolloClient');
    const client = mod.default as ApolloClient<unknown>;

    client.cache.writeQuery({
      query: PET_QUERY,
      variables: { id: 'pet-1' },
      data: { pet: { __typename: 'Pet', id: 'pet-1', name: 'Account A Dog' } },
    });
    expect(
      client.cache.readQuery({ query: PET_QUERY, variables: { id: 'pet-1' } }),
    ).not.toBeNull();

    await resetApolloStore();

    expect(
      client.cache.readQuery({ query: PET_QUERY, variables: { id: 'pet-1' } }),
    ).toBeNull();
  });

  it('is a safe no-op on an already-empty (offline logout) cache', async () => {
    const { resetApolloStore } = await import('../apolloClient');
    await expect(resetApolloStore()).resolves.toBeUndefined();
  });

  it('coalesces concurrent resets into a single teardown', async () => {
    const mod = await import('../apolloClient');
    const client = mod.default as ApolloClient<unknown>;
    const spy = jest.spyOn(client, 'clearStore');

    await Promise.all([mod.resetApolloStore(), mod.resetApolloStore(), mod.resetApolloStore()]);

    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
