import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: { rollupOptions: { input: { options: 'index.html', popup: 'popup.html' } } },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          exclude: [
            ...configDefaults.exclude,
            'tests/{captions,content,controller,prefetch,youtube,hbo}.test.ts',
            'tests/{popup,settings-alerts,settings-models}.test.tsx',
          ],
        },
      },
      {
        extends: true,
        test: {
          name: 'dom',
          environment: 'jsdom',
          include: [
            'tests/{captions,content,controller,prefetch}.test.ts',
            'tests/{popup,settings-alerts,settings-models}.test.tsx',
          ],
        },
      },
      {
        extends: true,
        test: {
          name: 'hbo',
          environment: 'jsdom',
          include: ['tests/hbo.test.ts'],
          environmentOptions: { jsdom: { url: 'https://play.hbomax.com/video/watch/episode-1' } },
        },
      },
      {
        extends: true,
        test: {
          name: 'youtube',
          environment: 'jsdom',
          include: ['tests/youtube.test.ts'],
          environmentOptions: { jsdom: { url: 'https://www.youtube.com/watch?v=video-1' } },
        },
      },
    ],
  },
});
