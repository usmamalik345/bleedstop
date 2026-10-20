/**
 * Local deterministic embedding (no paid API needed).
 * Think: turn text into a list of numbers that mean "what words showed up".
 * Production: swap for OpenAI/Gemini embeddings — same retrieve() interface.
 */

const DIM = 64;

export function embedText(text) {
  const vec = new Array(DIM).fill(0);
  const tokens = tokenize(text);
  if (tokens.length === 0) return vec;

  for (const token of tokens) {
    let h = 2166136261;
    for (let i = 0; i < token.length; i++) {
      h ^= token.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const idx = Math.abs(h) % DIM;
    vec[idx] += 1;
  }

  // L2 normalize
  const norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0)) || 1;
  return vec.map((x) => x / norm);
}

export function cosine(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

export function tokenize(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
}
