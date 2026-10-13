// Build toàn bộ extension vào dist/:
//  - sidepanel + viewer (React, multi-page)
//  - background.js (ES module service worker)
//  - content.js (IIFE — content script không hỗ trợ ES module)
//  - route-hook.js (IIFE, chạy ở MAIN world để bắt history.pushState)
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmSync } from 'node:fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'dist');
const watch = process.argv.includes('--watch') ? {} : null;
const minify = !watch;

rmSync(outDir, { recursive: true, force: true });

// 1. Extension pages
await build({
  configFile: false,
  root: resolve(root, 'src'),
  base: '/',
  publicDir: resolve(root, 'public'),
  plugins: [react()],
  logLevel: 'warn',
  build: {
    outDir,
    emptyOutDir: false,
    target: 'es2022',
    minify,
    watch,
    rollupOptions: {
      input: {
        sidepanel: resolve(root, 'src/sidepanel/index.html'),
        viewer: resolve(root, 'src/viewer/index.html'),
      },
    },
  },
});

// 2. Scripts dạng single-file
const scripts = [
  { entry: 'src/background/index.ts', name: 'background', format: 'es' },
  { entry: 'src/content/index.ts', name: 'content', format: 'iife' },
  { entry: 'src/content/route/routeHook.ts', name: 'route-hook', format: 'iife' },
];

for (const s of scripts) {
  await build({
    configFile: false,
    publicDir: false,
    logLevel: 'warn',
    build: {
      outDir,
      emptyOutDir: false,
      target: 'es2022',
      minify,
      watch,
      lib: {
        entry: resolve(root, s.entry),
        formats: [s.format],
        name: s.name.replace(/-/g, '_'),
        fileName: () => `${s.name}.js`,
      },
    },
  });
}

console.log('✔ Build xong → dist/  (chrome://extensions → Load unpacked → chọn thư mục dist)');
