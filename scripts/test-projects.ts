export const testInclude = ['tests/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'];

export const domTestProjects = [
  {
    name: 'dom',
    environment: 'jsdom',
    include: [
      'tests/captions.test.ts',
      'tests/content.test.ts',
      'tests/controller.test.ts',
      'tests/prefetch.test.ts',
      'tests/popup.test.tsx',
      'tests/settings-alerts.test.tsx',
      'tests/settings-models.test.tsx',
    ],
  },
  {
    name: 'hbo',
    environment: 'jsdom',
    include: ['tests/hbo.test.ts'],
    environmentOptions: { jsdom: { url: 'https://play.hbomax.com/video/watch/episode-1' } },
  },
  {
    name: 'youtube',
    environment: 'jsdom',
    include: ['tests/youtube.test.ts'],
    environmentOptions: { jsdom: { url: 'https://www.youtube.com/watch?v=video-1' } },
  },
  {
    name: 'x',
    environment: 'jsdom',
    include: ['tests/x.test.ts'],
    environmentOptions: { jsdom: { url: 'https://x.com/NASA/status/1' } },
  },
];
