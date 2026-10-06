/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
  moduleNameMapper: {
    '^@src/(.*)$': '<rootDir>/$1',
    // jose v6 is ESM-only; the real JWKS machinery is stubbed in tests
    '^jose$': '<rootDir>/tests/jose.stub.ts',
  },
  testTimeout: 30000,
};
