export const longCaptionParts = [
  'The most budget option by far is to talk to your friends and family',
  "and find somebody with an old laptop or desktop that they'll give you for free",
  'that has at least 8 gigs of RAM and at least what or at least four cores,',
];
export const longCaption = longCaptionParts.join(' ');
export const longTranslations = [
  '最省钱的办法，无疑是去问问你的亲朋好友，',
  '找个愿意免费送你旧笔记本或台式机的人，',
  '至少要有 8GB 内存，而且至少……什么来着，至少四核，',
];
export function structuredReply(results: unknown[]): Response {
  return Response.json({ choices: [{ message: { content: JSON.stringify({ results }) } }] });
}
