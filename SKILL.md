# Tool Creator

You create OpenClaw agent tools from existing skills. When the user asks you to
add a tool to a skill, create a `plugin.ts` in that skill's directory.

## What you produce

A `skills/<name>/plugin.ts` file that exports a default function receiving the
plugin API and calling `api.registerTool()`.

## Template

```ts
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default function (api) {
  api.registerTool({
    name: "SKILLNAME_ACTION",
    description: "One sentence: what the tool does and when to use it",
    parameters: {
      type: "object",
      properties: {
        // define params here
      },
      required: [/* list required param names */],
    },
    async execute(_id, params) {
      try {
        // do work
        const result = "...";
        return { content: [{ type: "text", text: result }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error: ${msg}` }] };
      }
    },
  });
}
```

## Rules

### Naming

- Tool names: `snake_case`, prefixed with skill name. Example: `dataanalysis_query`.
- Never use a core tool name: `exec`, `browser`, `message`, `read`, `write`,
  `edit`, `apply_patch`, `process`, `canvas`, `nodes`, `cron`, `gateway`, `image`,
  `web_search`, `web_fetch`, `sessions_list`, `sessions_history`, `sessions_send`,
  `sessions_spawn`, `session_status`, `agents_list`, `memory_search`, `memory_get`.

### Parameters (JSON Schema)

- Always use `type: "object"` at the top level with `properties` and `required`.
- Use `{ type: "string", enum: [...] }` for string enums. Never use `anyOf`, `oneOf`, or `allOf`.
- Mark optional params by omitting them from `required`. Add sensible defaults in `execute()`.
- Every property needs a `description`.

### Return values

- Always return `{ content: [{ type: "text", text: "..." }] }`.
- For structured data, JSON.stringify it: `{ content: [{ type: "text", text: JSON.stringify(data, null, 2) }] }`.
- For images: `{ content: [{ type: "image", data: base64, mimeType: "image/png" }] }`.
- Never return an empty `content` array.

### Error handling

- Wrap `execute()` body in try/catch. Return errors as text content so the agent sees them.
- Validate params at the top of execute. Don't trust the LLM to send correct types.

### Running external scripts

- Use `child_process.spawn` (never `execSync`).
- Always set a timeout (default 30s). Kill the process on timeout.
- Use `__dirname` to locate sibling scripts. Never hardcode absolute paths.
- Use `stdio: ["ignore", "pipe", "pipe"]` (or `["pipe", ...]` if sending stdin).
- Scripts should print JSON to stdout. Parse it in the tool.

Spawn helper you can copy into any plugin.ts:

```ts
function run(cmd, args, { cwd = __dirname, timeoutMs = 30_000, input } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      stdio: [input != null ? "pipe" : "ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Timed out"));
    }, timeoutMs);
    child.on("error", (err) => { clearTimeout(timer); reject(err); });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(stderr || `Exit ${code}`));
      else resolve({ stdout: stdout.trim(), stderr });
    });
    if (input != null) {
      child.stdin.write(input);
      child.stdin.end();
    }
  });
}
```

### Python scripts

- Place the `.py` file next to `plugin.ts` in the same skill directory.
- Reference it with `join(__dirname, "script.py")`.
- If the script needs a venv, use `join(__dirname, "venv", "bin", "python3")` as the binary.
- Pass structured input via stdin (`JSON.stringify` on TS side, `json.load(sys.stdin)` on Python side).
- Script should print JSON to stdout, nothing else (use stderr for debug logs).

### Multiple tools

- One `plugin.ts` can call `api.registerTool()` multiple times.
- Use separate tools when they have different parameters.
- Use a single tool with an `action` enum when tools share context and parameters.

### What NOT to do

- Don't use `Type.Union` or `anyOf`/`oneOf`/`allOf` in parameter schemas.
- Don't use `execSync` or any synchronous child process call.
- Don't spawn long-lived background processes from `execute()`.
- Don't put secrets in parameters. Read from env vars or `api.pluginConfig`.
- Don't hardcode absolute paths.
- Don't return empty content arrays.

## Finding documentation

Skill directories often contain `.md` files that describe what the skill does,
how it works, and what tools/scripts are available. Before writing a tool:

- Read **all `.md` files** in the skill directory (`skills/<name>/*.md`).
  Common files: `SKILL.md` (skill prompt), `TOOLS.md` (tool usage), `README.md`.
- If the tool description alone is not enough to understand behavior or expected
  inputs/outputs, check these docs first — they are the source of truth.
- When writing tool descriptions, reference the skill's docs if relevant:
  e.g. `"Run the analysis pipeline described in skills/data-analysis/TOOLS.md"`.

## Workflow

When asked to create a tool for an existing skill:

1. Read **all `.md` files** in the skill directory to understand what it does.
2. Identify what actions should become tool calls (look for verbs: search, create, run, analyze).
3. Design parameters — what inputs does the agent need to provide?
4. Write `plugin.ts` in the skill directory.
5. If the tool needs an external script, write that too.
6. The gateway must be restarted to pick up new tools.
