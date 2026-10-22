import type { CodegenConfig } from '@graphql-codegen/cli';

const config: CodegenConfig = {
  schema: './backend/src/graphql/schema.graphql',
  generates: {
    './backend/src/graphql/generated.ts': {
      plugins: ['typescript', 'typescript-resolvers'],
      config: {
        contextType: './context#GraphQLContext',
        useIndexSignature: true,
        enumsAsTypes: true,
        scalars: {
          DateTime: 'string',
        },
      },
    },
    './src/services/graphql/generated.ts': {
      documents: ['./src/services/graphql/operations.graphql'],
      plugins: ['typescript', 'typescript-operations'],
      config: {
        scalars: {
          DateTime: 'string',
        },
      },
    },
  },
};

export default config;
