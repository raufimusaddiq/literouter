export const PLACEHOLDER_KEY = "sk-...your-key";
const MODEL = "your-model-or-combo";

export function buildSnippets(baseUrl) {
  return [
    {
      id: "curl",
      label: "curl",
      code: `curl ${baseUrl}/chat/completions \\
  -H "Authorization: Bearer ${PLACEHOLDER_KEY}" \\
  -H "Content-Type: application/json" \\
  -d '{"model": "${MODEL}", "messages": [{"role": "user", "content": "Hello"}]}'`,
    },
    {
      id: "python",
      label: "Python",
      code: `from openai import OpenAI

client = OpenAI(base_url="${baseUrl}", api_key="${PLACEHOLDER_KEY}")
resp = client.chat.completions.create(
    model="${MODEL}",
    messages=[{"role": "user", "content": "Hello"}],
)
print(resp.choices[0].message.content)`,
    },
    {
      id: "node",
      label: "Node",
      code: `import OpenAI from "openai";

const client = new OpenAI({ baseURL: "${baseUrl}", apiKey: "${PLACEHOLDER_KEY}" });
const resp = await client.chat.completions.create({
  model: "${MODEL}",
  messages: [{ role: "user", content: "Hello" }],
});
console.log(resp.choices[0].message.content);`,
    },
  ];
}
