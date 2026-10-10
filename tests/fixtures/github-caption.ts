export const githubCaption =
  "Myself, Mitchell the creator of Ghostie, and many other people are realizing that GitHub might not be the safest place for us to be leaving our code now that they're randomly reverting merges and having downtime that is measured in days.";

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

export const githubCommaParts = [
  'Myself, Mitchell the creator of Ghostie,',
  githubCaption.slice('Myself, Mitchell the creator of Ghostie, '.length),
];
