import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    headers: {
      // Required for Pyodide SharedArrayBuffer / Atomics
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  // Ensure the whl file is served as a static asset (no transform)
  assetsInclude: ['**/*.whl'],
  optimizeDeps: {
    // Don't pre-bundle Pyodide — it's loaded via CDN script tag
    exclude: [],
  },
})
