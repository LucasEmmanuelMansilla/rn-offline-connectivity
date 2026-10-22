/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/*.test.ts', '<rootDir>/src/**/*.test.tsx'],
  passWithNoTests: true,
  clearMocks: true,
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          esModuleInterop: true,
          strict: true,
          jsx: 'react-jsx',
          types: ['jest', 'react'],
          isolatedModules: true,
          module: 'commonjs',
          moduleResolution: 'bundler',
          target: 'ES2019',
        },
      },
    ],
  },
};
