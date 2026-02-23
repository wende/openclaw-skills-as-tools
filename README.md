# openclaw-skills-as-tools

Auto-discovers `skills/**/plugin.ts` files in your workspace and registers them as OpenClaw agent tools.

## Install

Clone into your workspace's extensions directory:

```bash
git clone https://github.com/youruser/openclaw-skills-as-tools .openclaw/extensions/openclaw-skills-as-tools
```

OpenClaw auto-discovers `.openclaw/extensions/*/index.ts` — no config changes needed.

Restart the gateway.

## Writing a skill tool

Create `skills/<name>/plugin.ts` in your workspace:

```ts
export default function (api) {
  api.registerTool({
    name: "my_tool",
    description: "Does the thing",
    parameters: {
      type: "object",
      properties: {
        input: { type: "string", description: "The input" },
      },
      required: ["input"],
    },
    async execute(_id, params) {
      return { content: [{ type: "text", text: `Got: ${params.input}` }] };
    },
  });
}
```

The loader walks `skills/` recursively, so nested structures like `skills/category/my-skill/plugin.ts` work too.

## Optional tools

Pass `{ optional: true }` if the tool should require explicit opt-in:

```ts
export default function (api) {
  api.registerTool(
    {
      name: "dangerous_tool",
      description: "Needs explicit allow",
      parameters: { type: "object", properties: {} },
      async execute() {
        return { content: [{ type: "text", text: "done" }] };
      },
    },
    { optional: true },
  );
}
```

Then enable in config: `tools.allow: ["dangerous_tool"]`.
