export function requestedTexts(init: RequestInit): string[] {
  const { messages } = JSON.parse(init.body as string) as {
    messages: { role: string; content: string }[];
  };
  return messages[0].content.includes('{"translations":')
    ? JSON.parse(messages[1].content)
    : [messages[1].content];
}

export function providerReply(texts: string[], translate: (text: string) => string): Response {
  const translations = texts.map(translate);
  return Response.json({
    choices: [
      {
        message: {
          content: texts.length > 1 ? JSON.stringify({ translations }) : translations[0],
        },
      },
    ],
  });
}
