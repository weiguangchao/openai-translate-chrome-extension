import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { domTestProjects, testInclude } from './scripts/test-projects';

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
          include: testInclude,
          exclude: [
            ...configDefaults.exclude,
            ...domTestProjects.flatMap((project) => project.include),
          ],
        },
      },
      ...domTestProjects.map((test) => ({ extends: true as const, test })),
    ],
  },
});
