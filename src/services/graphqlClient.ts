import { createClient, fetchExchange, type Client, type Operation } from '@urql/core';
import { makeOperation } from '@urql/core';

import { getItem } from './localDB';
import config from '../config';

const ACCESS_TOKEN_KEY = '@access_token';

const _authExchange = () => ({
  name: 'authExchange',
  async applyAuth(operation: Operation): Promise<Operation> {
    const token = await getItem(ACCESS_TOKEN_KEY);
    if (!token) return operation;
    return makeOperation(operation.kind, operation, {
      ...operation.context,
      fetchOptions: {
        ...(typeof operation.context.fetchOptions === 'object'
          ? operation.context.fetchOptions
          : {}),
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    });
  },
});

const client: Client = createClient({
  url: `${config.api.baseUrl}/graphql`,
  exchanges: [fetchExchange],
  fetchOptions: () => ({ headers: { 'Content-Type': 'application/json' } }),
});

export async function gqlRequest<T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const token = await getItem(ACCESS_TOKEN_KEY);
  const result = await client
    .query<T>(query, variables ?? {}, {
      fetchOptions: {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
    })
    .toPromise();

  if (result.error) throw new Error(result.error.message);
  return result.data as T;
}

export default client;
