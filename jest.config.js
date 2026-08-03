// ESM-only packages that must be transpiled to CJS for Jest.
const esmOnlyDeps = ['stream-json', 'stream-chain'];

export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
        // ts-jest's ESM mode overrides `module`, which drops moduleResolution
        // to Node10 and breaks NodeNext package "exports" lookups (stream-json
        // subpath imports); 'bundler' restores exports-map resolution.
        tsconfig: { moduleResolution: 'bundler' },
      },
    ],
    [`[\\\\/](${esmOnlyDeps.join('|')})[\\\\/].*\\.js$`]: [
      'ts-jest',
      {
        isolatedModules: true,
        tsconfig: { allowJs: true, checkJs: false, module: 'commonjs' },
      },
    ],
  },
  // Ignore node_modules except paths that contain an ESM-only dep anywhere
  // after them — position-independent, so it works for both direct layouts
  // and pnpm's node_modules/.pnpm/<pkg>@<ver>/node_modules/<pkg> paths.
  transformIgnorePatterns: [
    `[\\\\/]node_modules[\\\\/](?!.*(${esmOnlyDeps.join('|')}))`,
  ],
  setupFiles: ['<rootDir>/src/__tests__/setupEnv.ts'],
  testMatch: [
    '**/__tests__/**/*.test.ts',
    '**/?(*.)+(spec|test).ts'
  ],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/e2e/'
  ],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/cli.ts'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
};
