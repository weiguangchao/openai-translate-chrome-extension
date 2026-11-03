import type { PlaybackCue } from '../../src/shared/playback-plan';

export function prefetchItems(texts: readonly string[], startAt = 0): PlaybackCue[] {
  return texts.map((text, index) => {
    const start = startAt + index * 4;
    return { text, start, end: start + 4 };
  });
}

export function packedCues(texts: readonly string[], start = 5): PlaybackCue[] {
  return texts.map((text, index) => {
    const at = start + index * 0.5;
    return { text, start: at, end: at + 0.5 };
  });
}

export function requestedTexts(init: RequestInit): string[] {
  const { messages } = JSON.parse(init.body as string) as {
    messages: { role: string; content: string }[];
  };
  return [messages[1].content.slice(messages[1].content.indexOf('\n\n') + 2)];
}

export function providerReply(texts: string[], translate: (text: string) => string): Response {
  return Response.json({
    choices: [
      {
        message: {
          content: translate(texts[0]),
        },
      },
    ],
  });
}

export function translationReply(content: string): Response {
  return Response.json({ choices: [{ message: { content } }] });
}
