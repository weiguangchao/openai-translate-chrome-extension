export function requestedTexts(init: RequestInit): string[] {
  const { messages } = JSON.parse(init.body as string) as {
    messages: { role: string; content: string }[];
  };
  if (messages[0].content.includes('{"results":'))
    return (JSON.parse(messages[1].content) as { text: string }[]).map((item) => item.text);
  return [messages[1].content];
}

export function providerReply(texts: string[], translate: (text: string) => string): Response {
  return Response.json({
    choices: [
      {
        message: {
          content: JSON.stringify({
            results: texts.map((text, id) => ({
              id,
              parts: [{ translation: translate(text) }],
            })),
          }),
        },
      },
    ],
  });
}
