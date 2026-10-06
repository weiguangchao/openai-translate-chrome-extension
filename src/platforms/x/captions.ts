export function xMediaUrl(value: string, base?: string): string | undefined {
  try {
    const url = new URL(value, base);
    if (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      url.hostname === 'video.twimg.com'
    )
      return url.href;
  } catch {}
}

export function parseXSubtitlePlaylist(text: string, url: string): string[] {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r\n?|\n/)
    .map((line) => line.trim());
  if (lines[0] !== '#EXTM3U' || !lines.includes('#EXT-X-ENDLIST')) return [];
  const segments: string[] = [];
  let segment = false;
  for (const line of lines) {
    if (line.startsWith('#EXTINF:')) segment = true;
    else if (segment && line && !line.startsWith('#')) {
      segment = false;
      const resolved = xMediaUrl(line, url);
      if (resolved) segments.push(resolved);
      if (segments.length > 256) return [];
    }
  }
  return segments;
}
