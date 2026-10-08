export const translationBatchLimit = 5;
export const prefetchBatchCount = 3;
export const prefetchSentenceCount = translationBatchLimit * prefetchBatchCount;
export const prefetchWindowLimit = 1 + 2 * (prefetchSentenceCount + 1);
