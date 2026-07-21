const base = require('./jest.config');

module.exports = {
  ...base,
  testPathIgnorePatterns: ['/node_modules/'],
  testRegex: 'test/integration/.*\\.spec\\.ts$',
  setupFiles: ['<rootDir>/test/integration/setup-env.ts'],
  testTimeout: 30000,
};
