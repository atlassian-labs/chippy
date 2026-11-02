import react from '@vitejs/plugin-react';

export default {
  core: { disableTelemetry: true },
  stories: ['../src/**/*.stories.@(js|jsx|mjs|ts|tsx)'],
  addons: ['./chippy-addon/preset.js'],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
  viteFinal: (config) => {
    config.build = { ...config.build, target: 'es2022' };
    // Force the development JSX transform
    config.esbuild = {
      ...config.esbuild,
      jsx: 'automatic',
      jsxDev: true,
    };
    return config;
  },
};
