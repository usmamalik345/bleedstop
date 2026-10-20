/**
 * Deterministic mock of the OpenAI Chat Completions and Responses APIs (no network, no cost).
 * Used by tests, benchmarks and the serverless demo. It "writes" N words where N is the requested
 * length hint in the prompt ("write 500 words") or 60, capped by max_tokens; asks for a tool call
 * when the prompt mentions "email" and tools are offered.
 */
const WORDS = "BleedStop checks every paid call before it happens so a runaway agent or a bot farm cannot burn the budget".split(" ");
const approxTokens = (s) => Math.ceil(String(s || "").length / 4);
export const promptText = (messages = []) => messages.map((m) => (typeof m.content === "string" ? m.content : Array.isArray(m.content) ? m.content.map((c) => c.text || "").join(" ") : "")).join("\n");

function plan(body) {
  const text = promptText(body.messages || (typeof body.input === "string" ? [{ content: body.input }] : body.input || []));
  const want = Number(/write (\d{1,6}) words/i.exec(text)?.[1] || 60);
  // "ignore max_tokens" in the prompt simulates an upstream that overruns the cap (or counts tokens differently)
  const cap = /ignore max_tokens/i.test(text) ? Infinity : Number(body.max_tokens ?? body.max_completion_tokens ?? body.max_output_tokens ?? 4096);
  const words = [];
  for (let i = 0; i < want; i++) words.push(WORDS[i % WORDS.length]);
  let content = words.join(" ");
  let finish = "stop";
  if (approxTokens(content) > cap) { content = content.slice(0, cap * 4); finish = "length"; }
  const wantsTool = /email/i.test(text) && Array.isArray(body.tools) && body.tools.length;
  return { text, content: wantsTool ? "" : content, finish: wantsTool ? "tool_calls" : finish, promptTokens: approxTokens(text), wantsTool };
}
const toolCall = (text) => {
  const to = /to ([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/i.exec(text)?.[1] || "team@acme.com";
  return [{ id: "call_mock_1", type: "function", function: { name: "send_email", arguments: JSON.stringify({ to, subject: "Report", body: "Here is the report." }) } }];
};

export function mockChat(body) {
  const p = plan(body);
  const id = `chatcmpl-mock-${Date.now().toString(36)}`;
  const model = body.model || "gpt-4o-mini";
  const usage = { prompt_tokens: p.promptTokens, completion_tokens: approxTokens(p.content) + (p.wantsTool ? 20 : 0), total_tokens: 0 };
  usage.total_tokens = usage.prompt_tokens + usage.completion_tokens;
  const message = p.wantsTool ? { role: "assistant", content: null, tool_calls: toolCall(p.text) } : { role: "assistant", content: p.content };
  if (!body.stream) return { json: { id, object: "chat.completion", created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, message, finish_reason: p.finish }], usage } };
  async function* sse() {
    const base = { id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model };
    yield { ...base, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] };
    if (p.wantsTool) yield { ...base, choices: [{ index: 0, delta: { tool_calls: message.tool_calls.map((t, i) => ({ index: i, ...t })) }, finish_reason: null }] };
    else for (const w of p.content.split(/(?<= )/)) yield { ...base, choices: [{ index: 0, delta: { content: w }, finish_reason: null }] };
    yield { ...base, choices: [{ index: 0, delta: {}, finish_reason: p.finish }] };
    if (body.stream_options?.include_usage) yield { ...base, choices: [], usage };
  }
  return { stream: sse() };
}

export function mockResponses(body) {
  const p = plan(body);
  const id = `resp_mock_${Date.now().toString(36)}`;
  const usage = { input_tokens: p.promptTokens, output_tokens: approxTokens(p.content), total_tokens: 0 };
  usage.total_tokens = usage.input_tokens + usage.output_tokens;
  const output = [{ type: "message", id: `msg_${id}`, role: "assistant", status: "completed", content: [{ type: "output_text", text: p.content, annotations: [] }] }];
  const done = { id, object: "response", status: p.finish === "length" ? "incomplete" : "completed", model: body.model || "gpt-4o-mini", output, output_text: p.content, usage };
  if (!body.stream) return { json: done };
  async function* sse() {
    yield { type: "response.created", response: { id, status: "in_progress" } };
    for (const w of p.content.split(/(?<= )/)) yield { type: "response.output_text.delta", item_id: `msg_${id}`, output_index: 0, content_index: 0, delta: w };
    yield { type: "response.completed", response: done };
  }
  return { stream: sse() };
}
