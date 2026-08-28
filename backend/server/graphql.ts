import * as fs from 'fs';
import type { Server } from 'http';
import * as path from 'path';

import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@apollo/server/express4';
import { ApolloServerPluginDrainHttpServer } from '@apollo/server/plugin/drainHttpServer';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { useServer } from 'graphql-ws/lib/use/ws';
import * as jwt from 'jsonwebtoken';
import { WebSocketServer } from 'ws';

import { type UserRole } from '../models/UserRole';
import { type GraphQLContext } from '../src/graphql/context';
import { createDataLoaders } from '../src/graphql/dataLoaders';
import { resolvers } from '../src/graphql/resolvers';

const typeDefs = fs.readFileSync(path.join(__dirname, '../graphql/schema.graphql'), 'utf-8');

const schema = makeExecutableSchema({ typeDefs, resolvers });

function extractUser(authHeader: string | undefined): GraphQLContext['user'] {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  if (!token) return null;
  try {
    const jwtSecret = process.env.JWT_SECRET || 'petchain-dev-secret-key-change-in-prod';
    const payload = jwt.verify(token, jwtSecret) as { sub: string; email: string; role: UserRole };
    return { id: payload.sub, email: payload.email, role: payload.role };
  } catch {
    return null;
  }
}

export function createGraphQLServer(httpServer: Server) {
  // WebSocket server for subscriptions
  const wsServer = new WebSocketServer({ server: httpServer, path: '/graphql' });

  // eslint-disable-next-line react-hooks/rules-of-hooks
  const serverCleanup = useServer(
    {
      schema,
      context: (ctx) => {
        const authHeader =
          (ctx.connectionParams?.Authorization as string | undefined) ??
          (ctx.connectionParams?.authorization as string | undefined);
        return {
          user: extractUser(authHeader),
          loaders: createDataLoaders(),
        } satisfies GraphQLContext;
      },
    },
    wsServer,
  );

  const apolloServer = new ApolloServer<GraphQLContext>({
    schema,
    plugins: [
      ApolloServerPluginDrainHttpServer({ httpServer }),
      {
        async serverWillStart() {
          return {
            async drainServer() {
              await serverCleanup.dispose();
            },
          };
        },
      },
    ],
  });

  return apolloServer;
}

export function buildGraphQLMiddleware(apolloServer: ApolloServer<GraphQLContext>) {
  return expressMiddleware(apolloServer, {
    context: async ({ req }): Promise<GraphQLContext> => ({
      user: extractUser(req.headers.authorization),
      loaders: createDataLoaders(),
    }),
  });
}
