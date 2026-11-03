import { defineConfig, type Plugin } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/** Номер сборки: вшивается в бандлы (`__BUILD_ID__`) и кладётся рядом с index.html в `version.json`. Страницы по нему узнают о новой версии. В dev и Vitest — `'dev'`. */
function buildId(build: boolean): Plugin {
  const id = build ? Date.now().toString(36) : 'dev';
  return {
    name: 'build-id',
    config: () => ({ define: { __BUILD_ID__: JSON.stringify(id) } }),
    generateBundle() {
      if (build) this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: id }) });
    },
  };
}

export default defineConfig(({ command }) => ({
  base: './',
  plugins: [buildId(command === 'build')],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: {
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
        admin: fileURLToPath(new URL('./admin.html', import.meta.url)),
        rg: fileURLToPath(new URL('./rg.html', import.meta.url)),
      },
    },
  },
  test: { include: ['src/**/*.test.ts', 'apps-script/test/**/*.test.mjs'] },
}));
