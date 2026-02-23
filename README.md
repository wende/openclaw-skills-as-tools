# openclaw-skills-as-tools

OpenClaw extension that auto-discovers `skills/**/plugin.ts` files in your workspace and registers them as agent tools and slash commands.

## What it does

On gateway startup, the loader:

1. Finds `skills/` in your configured workspace
2. Recursively walks it looking for `plugin.ts` (or `plugin.js`) files
3. Imports each one and calls its default export, passing the OpenClaw plugin API
4. Each plugin can register **agent tools** (`api.registerTool()`) and/or **slash commands** (`api.registerCommand()`)

Skips `node_modules`, `venv`, `.venv`, `__pycache__`, `dist`, `.git`, `.next`, and symlinks.

## Install

Clone into your workspace's extensions directory:

```bash
git clone https://github.com/wende/openclaw-skills-as-tools .openclaw/extensions/openclaw-skills-as-tools
```

OpenClaw auto-discovers `.openclaw/extensions/*/index.ts` — no config changes needed.

Restart the gateway.

## Agent tools

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

The agent sees this as a callable tool during conversations. Nested structures like `skills/category/my-skill/plugin.ts` work too.

### Optional tools

Pass `{ optional: true }` if the tool should require explicit opt-in:

```ts
api.registerTool(myTool, { optional: true });
```

Then enable in config: `tools.allow: ["my_tool"]`.

## Slash commands

Register commands that respond instantly without invoking the AI agent:

```ts
export default function (api) {
  api.registerCommand({
    name: "ping",
    description: "Check if the skill is loaded",
    handler: () => ({ text: "pong" }),
  });
}
```

Users send `/ping` in any channel and get `pong` back immediately.

Commands support arguments:

```ts
api.registerCommand({
  name: "set_lang",
  description: "Set default language",
  acceptsArgs: true,
  handler: (ctx) => {
    const lang = ctx.args?.trim() || "en";
    return { text: `Language set to: ${lang}` };
  },
});
```

## Mixing tools and commands

A single `plugin.ts` can register both:

```ts
export default function (api) {
  api.registerTool({
    name: "weather_lookup",
    description: "Look up weather for a city",
    parameters: { /* ... */ },
    async execute(_id, params) { /* ... */ },
  });

  api.registerCommand({
    name: "weather_units",
    description: "Toggle temperature units (C/F)",
    acceptsArgs: true,
    handler: (ctx) => ({ text: `Units: ${ctx.args?.trim() || "C"}` }),
  });
}
```

## Running external scripts

Tools can spawn Python, Node, or shell scripts. Place scripts next to `plugin.ts` and reference them via `__dirname`:

```ts
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// In execute():
const child = spawn("python3", [join(__dirname, "analyze.py"), params.query]);
```

## Troubleshooting

Check gateway logs for load errors:

```bash
grep "openclaw-skills-as-tools:" /tmp/openclaw/openclaw-$(date +%Y-%m-%d).log
```

Verify the plugin is loaded:

```bash
openclaw plugins list
```

## Docs

- [WRITING_TOOLS.md](WRITING_TOOLS.md) — full authoring guide (parameters, return values, scripts, error handling, dos and don'ts)
- [SKILL.md](SKILL.md) — agent-facing prompt for automated tool creation
