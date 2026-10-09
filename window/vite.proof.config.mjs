import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
export default defineConfig({
  plugins: [tailwindcss(), react()],
  resolve: { alias: [{ find: /^@branch\/gateway-client(\/browser)?$/, replacement: '/Users/taofikbishi/Library/Caches/claude-session-files/branch-god/browser-proof/gateway-browser-stub.mjs' }, { find: /^@branch\/gateway-protocol(\/.*)?$/, replacement: '/Users/taofikbishi/Library/Caches/claude-session-files/branch-god/browser-proof/gateway-browser-stub.mjs' }] },
  server: { host: '127.0.0.1', port: 5179, strictPort: true, fs: { allow: ['..', '/Users/taofikbishi/Library/Caches/claude-session-files/branch-god/browser-proof'] } },
});
