import type { SubtitleFile } from '../../core/webvtt';

export interface HboSubtitleTrack {
  language: string;
  role: string;
  files: SubtitleFile[];
}

export function hboMediaUrl(value: string, base?: string): string | undefined {
  try {
    const url = new URL(value, base);
    if (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      /(^|\.)(h264\.io|e\.hbo|hbomax\.com|max\.com|hbo\.com)$/.test(url.hostname)
    )
      return url.href;
  } catch {}
}

function children(element: Element, name: string): Element[] {
  return [...element.children].filter((child) => child.localName === name);
}

function duration(value: string | null): number {
  const match = value?.match(/^PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/);
  return match
    ? Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0)
    : NaN;
}

function baseUrl(element: Element, parent: string): string {
  const value = children(element, 'BaseURL')[0]?.textContent?.trim();
  return value ? (hboMediaUrl(value, parent) ?? '') : parent;
}

export function parseHboManifest(xml: string, url: string): HboSubtitleTrack[] {
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  const root = document.documentElement;
  if (root.localName !== 'MPD' || root.getAttribute('type') === 'dynamic') return [];
  const tracks = new Map<string, HboSubtitleTrack>();
  const preferred = new Map<string, string>();
  const rootBase = baseUrl(root, url);
  const periods = children(root, 'Period');
  let nextStart = 0;
  for (const [index, period] of periods.entries()) {
    const start = period.hasAttribute('start') ? duration(period.getAttribute('start')) : nextStart;
    const end = period.hasAttribute('duration')
      ? start + duration(period.getAttribute('duration'))
      : duration(
          periods[index + 1]?.getAttribute('start') ??
            root.getAttribute('mediaPresentationDuration'),
        );
    nextStart = end;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    const periodBase = baseUrl(period, rootBase);
    const periodTracks = new Map<string, HboSubtitleTrack & { id: string }>();
    for (const adaptation of children(period, 'AdaptationSet')) {
      const role = children(adaptation, 'Role')[0]?.getAttribute('value') ?? 'subtitle';
      const language = adaptation.getAttribute('lang') ?? '';
      if (!language || !['subtitle', 'caption', 'main'].includes(role)) continue;
      const representation = children(adaptation, 'Representation').find(
        (item) =>
          (item.getAttribute('mimeType') ?? adaptation.getAttribute('mimeType')) === 'text/vtt',
      );
      if (!representation) continue;
      const base = baseUrl(representation, baseUrl(adaptation, periodBase));
      if (!base) continue;
      const template =
        children(representation, 'SegmentTemplate')[0] ??
        children(adaptation, 'SegmentTemplate')[0];
      const files: SubtitleFile[] = [];
      if (template) {
        const media = template.getAttribute('media');
        const scale = Number(template.getAttribute('timescale') ?? 1);
        const offset = Number(template.getAttribute('presentationTimeOffset') ?? 0);
        let number = Number(template.getAttribute('startNumber') ?? 1);
        if (!media || !(scale > 0) || !Number.isFinite(offset) || !Number.isSafeInteger(number))
          continue;
        const timeline = children(template, 'SegmentTimeline')[0];
        const entries = timeline ? children(timeline, 'S') : [];
        let time = offset;
        const append = (at: number) => {
          const path = media.replace(
            /\$(Number|Time|RepresentationID)(?:%0(\d+)d)?\$/g,
            (_, kind: string, width: string) => {
              const value =
                kind === 'Number'
                  ? String(number)
                  : kind === 'Time'
                    ? String(at)
                    : (representation.getAttribute('id') ?? '');
              return value.padStart(Math.min(Number(width) || 0, 12), '0');
            },
          );
          const resolved = !path.includes('$') && hboMediaUrl(path, base);
          if (resolved) files.push({ url: resolved, offset: start - offset / scale });
          number++;
        };
        if (entries.length) {
          for (const [i, entry] of entries.entries()) {
            time = Number(entry.getAttribute('t') ?? time);
            const length = Number(entry.getAttribute('d'));
            const repeat = Number(entry.getAttribute('r') ?? 0);
            const until = Number(
              entries[i + 1]?.getAttribute('t') ?? offset + (end - start) * scale,
            );
            const count = repeat === -1 ? Math.ceil((until - time) / length) : repeat + 1;
            if (
              !Number.isFinite(time) ||
              !(length > 0) ||
              !Number.isSafeInteger(count) ||
              count < 1 ||
              files.length + count > 256
            )
              return [];
            for (let n = 0; n < count; n++, time += length) append(time);
          }
        } else {
          const length = Number(template.getAttribute('duration'));
          const count = Math.ceil(((end - start) * scale) / length);
          if (!(length > 0) || !Number.isSafeInteger(count) || count > 256) continue;
          for (let n = 0; n < count; n++) append(offset + n * length);
        }
      } else if (children(representation, 'BaseURL').length) {
        files.push({ url: base, offset: start });
      }
      if (!files.length) continue;
      const key = JSON.stringify([language, role]);
      const id = JSON.stringify([adaptation.getAttribute('id'), representation.getAttribute('id')]);
      const candidate = periodTracks.get(key);
      if (!candidate || (id === preferred.get(key) && candidate.id !== id))
        periodTracks.set(key, { id, language, role, files });
    }
    for (const [key, candidate] of periodTracks) {
      const track = tracks.get(key) ?? {
        language: candidate.language,
        role: candidate.role,
        files: [],
      };
      track.files.push(...candidate.files);
      if (track.files.length > 256) return [];
      tracks.set(key, track);
      preferred.set(key, candidate.id);
    }
  }
  return [...tracks.values()];
}
