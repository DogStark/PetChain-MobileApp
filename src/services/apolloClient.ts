import {
  ApolloClient,
  InMemoryCache,
  createHttpLink,
  split,
  type NormalizedCacheObject,
} from '@apollo/client';
import { setContext } from '@apollo/client/link/context';
import { onError } from '@apollo/client/link/error';
import { GraphQLWsLink } from '@apollo/client/link/subscriptions';
import { getMainDefinition } from '@apollo/client/utilities';
import { createClient as createWsClient } from 'graphql-ws';

// Lazy token getter — avoids importing expo-secure-store at module level
// so this file can be imported in non-Expo environments (tests, SSR, etc.)
let _getToken: (() => Promise<string | null>) | null = null;

export function setTokenProvider(fn: () => Promise<string | null>): void {
  _getToken = fn;
}

async function getToken(): Promise<string | null> {
  if (_getToken) return _getToken();
  return null;
}

const GRAPHQL_HTTP_URL = process.env.GRAPHQL_HTTP_URL ?? 'http://localhost:3000/graphql';
const GRAPHQL_WS_URL = process.env.GRAPHQL_WS_URL ?? 'ws://localhost:3000/graphql';

// HTTP link
const httpLink = createHttpLink({ uri: GRAPHQL_HTTP_URL });

// Auth link — attaches Bearer token to every HTTP request
const authLink = setContext(async (_, { headers }) => {
  const token = await getToken();
  return {
    headers: {
      ...headers,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  };
});

// Error link — logs GraphQL and network errors
const errorLink = onError(({ graphQLErrors, networkError }) => {
  if (graphQLErrors) {
    for (const { message, extensions } of graphQLErrors) {
      console.warn(`[GraphQL error] ${extensions?.code ?? 'UNKNOWN'}: ${message}`);
    }
  }
  if (networkError) {
    console.warn(`[Network error] ${networkError.message}`);
  }
});

// WebSocket link for subscriptions — sends auth token via connectionParams
const wsLink = new GraphQLWsLink(
  createWsClient({
    url: GRAPHQL_WS_URL,
    connectionParams: async () => {
      const token = await getToken();
      return token ? { Authorization: `Bearer ${token}` } : {};
    },
    retryAttempts: 5,
  }),
);

// Route subscriptions over WS, queries/mutations over HTTP
const splitLink = split(
  ({ query }) => {
    const def = getMainDefinition(query);
    return def.kind === 'OperationDefinition' && def.operation === 'subscription';
  },
  wsLink,
  errorLink.concat(authLink.concat(httpLink)),
);

const apolloClient: ApolloClient<NormalizedCacheObject> = new ApolloClient({
  link: splitLink,
  cache: new InMemoryCache(),
  defaultOptions: {
    watchQuery: { fetchPolicy: 'cache-and-network' },
  },
});

export default apolloClient;
