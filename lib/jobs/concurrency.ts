import pLimit from 'p-limit'

export const scrapeLimit = pLimit(5)
export const signalLimit = pLimit(8)
export const llmLimit = pLimit(2)
