// ESM-only packages that must be transpiled to CJS for Jest.
const esmOnlyDeps = ['stream-json', 'stream-chain'];

export default {
  testEnvironment: 'node',
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.tsx?$': [
      '@swc/jest',
      { jsc: { parser: { syntax: 'typescript' }, target: 'es2022' } },
    ],
    [`[\\\\/](${esmOnlyDeps.join('|')})[\\\\/].*\\.js$`]: [
      '@swc/jest',
      { jsc: { parser: { syntax: 'ecmascript' }, target: 'es2022' } },
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
