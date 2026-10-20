/**
 * Turn a JS number array into pgvector text: [0.1,0.2,...]
 */
export function toVectorLiteral(embedding = []) {
  return `[${embedding.map((n) => Number(n) || 0).join(",")}]`;
}
