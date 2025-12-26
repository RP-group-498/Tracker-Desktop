import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import { resolve } from 'path';

// Resolve paths relative to this config file's directory (electron/)
const electronRoot = __dirname;

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        // Main process entry - use absolute path
        entry: resolve(electronRoot, 'src/main/index.ts'),
        vite: {
          build: {
            outDir: resolve(electronRoot, 'dist/main'),
            rollupOptions: {
              external: ['electron'],
            },
          },
        },
      },
      {
        // Preload script - use absolute path
        entry: resolve(electronRoot, 'src/preload/index.ts'),
        vite: {
          build: {
            outDir: resolve(electronRoot, 'dist/preload'),
            rollupOptions: {
              external: ['electron'],
            },
          },
        },
        onstart(options) {
          options.reload();
        },
      },
    ]),
    renderer(),
  ],
  resolve: {
    alias: {
      '@': resolve(electronRoot, 'src'),
    },
  },
  build: {
    outDir: resolve(electronRoot, 'dist/renderer'),
  },
  root: resolve(electronRoot, 'src/renderer'),
});
