export const githubCaption =
  "Myself, Mitchell the creator of Ghostie, and many other people are realizing that GitHub might not be the safest place for us to be leaving our code now that they're randomly reverting merges and having downtime that is measured in days instead of minutes.";

export const githubCaptionTrack = {
  events: [
    {
      tStartMs: 0,
      dDurationMs: 11000,
      segs: githubCaption.split(' ').map((word, index) => ({
        utf8: `${index ? ' ' : ''}${word}`,
        tOffsetMs: index * 250,
      })),
    },
  ],
};

export const githubModelResponse = {
  segments: [
    {
      source: 'Myself, Mitchell the creator of Ghostie, and many other people are realizing',
      translation: '我、Ghostie 的创作者米切尔，还有许多人都开始意识到',
    },
    {
      source: 'that GitHub might not be the safest place for us to be leaving our code',
      translation: 'GitHub 可能已经不是存放我们代码最安全的地方了',
    },
    {
      source: "now that they're randomly reverting merges",
      translation: '因为他们会莫名其妙地撤销合并',
    },
    {
      source: 'and having downtime that is measured in days instead of minutes.',
      translation: '停机时间更是按天计算，而不是按分钟。',
    },
  ],
};
