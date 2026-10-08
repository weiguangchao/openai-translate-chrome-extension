export const translationBatchLimit = 4;
export const prefetchBatchCount = 4;
export const prefetchSentenceCount = translationBatchLimit * prefetchBatchCount;
export const prefetchWindowLimit = 1 + 2 * (prefetchSentenceCount + 1);
