import { expect, it } from 'vitest';
import manifest from '../public/manifest.json';
import { PLATFORMS, platformForUrl, platformMatches } from '../src/shared/platforms';

const { content_scripts: scripts, host_permissions: hosts } = manifest as {
  content_scripts: { matches: string[]; js: string[]; world?: string }[];
  host_permissions: string[];
};

it('injects each platform page and content script exactly on its registered sites', () => {
  expect(hosts).toEqual(platformMatches);
  expect(scripts).toHaveLength(PLATFORMS.length * 2);
  for (const platform of PLATFORMS) {
    const own = scripts.filter((script) =>
      script.js.every((file) => file.startsWith(`${platform.id}-`)),
    );
    expect(own.map(({ js, world }) => [js, world ?? 'ISOLATED'])).toEqual([
      [[`${platform.id}-page.js`], 'MAIN'],
      [[`${platform.id}-content.js`], 'ISOLATED'],
    ]);
    for (const script of own) expect(script.matches).toEqual(platform.matches);
  }
});

it('recognizes registered sites and rejects lookalike or insecure hosts', () => {
  expect(
    [
      'https://www.youtube.com/watch?v=1',
      'https://m.youtube.com/',
      'https://play.max.com/video',
      'https://play.hbomax.com/',
      'https://www.hbo.com/',
      'https://x.com/NASA/status/1',
      'https://twitter.com/NASA',
    ].map(platformForUrl),
  ).toEqual(['youtube', 'youtube', 'hbo', 'hbo', 'hbo', 'x', 'x']);
  for (const url of [
    'http://www.youtube.com/',
    'https://notyoutube.com/',
    'https://youtube.com.evil.example/',
    'https://imax.com/',
    'https://box.com/',
    'https://x.com.evil.example/',
    'http://x.com/',
    'chrome-extension://extension-id/popup.html',
    'not a url',
    undefined,
  ])
    expect(platformForUrl(url)).toBeUndefined();
});
