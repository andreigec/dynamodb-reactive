import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    client: 'src/client.ts',
    server: 'src/server.ts',
    core: 'src/core.ts',
    infra: 'src/infra.ts',
    react: 'src/react.ts',
  },
  format: ['esm'],
  outExtension: () => ({ js: '.js', dts: '.d.ts' }),
  dts: {
    compilerOptions: {
      rootDir: '..',
      baseUrl: '.',
      paths: {
        '@dynamodb-reactive/core': ['../core/src/index.ts'],
        '@dynamodb-reactive/client': ['../client/src/index.ts'],
        '@dynamodb-reactive/client/react': ['../client/src/react.tsx'],
        '@dynamodb-reactive/server': ['../server/src/index.ts'],
        '@dynamodb-reactive/infra': ['../infra/src/index.ts'],
      },
    },
  },
  sourcemap: true,
  clean: true,
  splitting: true,
  treeshake: true,
  external: [
    'react',
    'zod',
    'aws-cdk-lib',
    'constructs',
    '@aws-sdk/client-dynamodb',
    '@aws-sdk/lib-dynamodb',
    '@aws-sdk/util-dynamodb',
    '@aws-sdk/client-apigatewaymanagementapi',
  ],
  esbuildOptions(options) {
    options.alias = {
      '@dynamodb-reactive/core': '../core/src/index.ts',
      '@dynamodb-reactive/client': '../client/src/index.ts',
      '@dynamodb-reactive/client/react': '../client/src/react.tsx',
      '@dynamodb-reactive/server': '../server/src/index.ts',
      '@dynamodb-reactive/infra': '../infra/src/index.ts',
    };
  },
});
