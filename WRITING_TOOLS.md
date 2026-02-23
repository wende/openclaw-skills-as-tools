# Writing Skill Tools

This guide covers how to write `plugin.ts` files that register agent tools from your `skills/` directory.

## Basics

A skill tool is a `skills/<name>/plugin.ts` file that exports a function receiving the plugin API:

```ts
export default function (api) {
  api.registerTool({
    name: "greet",
    description: "Greet someone by name",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Person to greet" },
      },
      required: ["name"],
    },
    async execute(_toolCallId, params) {
      return {
        content: [{ type: "text", text: `Hello, ${params.name}!` }],
      };
    },
  });
}
```

The agent sees `greet` as a callable tool. When it calls it with `{ "name": "Alice" }`, the execute function runs and the agent receives `Hello, Alice!`.

## Parameters

### Plain JSON Schema

The simplest approach — no imports needed:

```ts
parameters: {
  type: "object",
  properties: {
    query: { type: "string", description: "Search query" },
    limit: { type: "integer", description: "Max results", default: 10 },
    tags: {
      type: "array",
      items: { type: "string" },
      description: "Filter tags",
    },
  },
  required: ["query"],
},
```

### TypeBox (typed schemas)

If you want TypeScript inference on `params`:

```ts
import { Type } from "@sinclair/typebox";

parameters: Type.Object({
  query: Type.String({ description: "Search query" }),
  limit: Type.Optional(Type.Integer({ description: "Max results" })),
  tags: Type.Optional(Type.Array(Type.String())),
}),
```

### String enums

Use `Type.Unsafe` for string enums. Do **not** use `Type.Union` for this — some model providers reject `anyOf`/`oneOf` in tool schemas:

```ts
// Good
action: Type.Unsafe<"start" | "stop" | "status">({
  type: "string",
  enum: ["start", "stop", "status"],
  description: "Action to perform",
}),

// Bad — may be rejected by providers
action: Type.Union([
  Type.Literal("start"),
  Type.Literal("stop"),
  Type.Literal("status"),
]),
```

Plain JSON Schema equivalent:

```ts
action: { type: "string", enum: ["start", "stop", "status"] },
```

### Optional parameters

Always mark non-required params as optional in both the schema and your code:

```ts
parameters: {
  type: "object",
  properties: {
    input: { type: "string" },
    verbose: { type: "boolean", default: false },
  },
  required: ["input"],  // verbose is optional
},
async execute(_id, params) {
  const verbose = params.verbose ?? false;
  // ...
},
```

## Return values

`execute()` must return an object with a `content` array:

```ts
// Text response (most common)
return {
  content: [{ type: "text", text: "result here" }],
};

// JSON response — stringify it for the agent
return {
  content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
};

// Image response
return {
  content: [
    { type: "text", text: "Here's the chart:" },
    { type: "image", data: base64String, mimeType: "image/png" },
  ],
};

// Structured details (for programmatic consumers, agent sees content only)
return {
  content: [{ type: "text", text: JSON.stringify(result) }],
  details: result,
};
```

## Running scripts

### Spawning a process

Use `child_process.spawn` for external scripts. This works for Python, Node, shell scripts, or any executable:

```ts
import { spawn } from "node:child_process";

function run(cmd, args, opts = {}) {
  const { cwd, env, timeoutMs = 30_000 } = opts;

  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`Exit ${code}: ${stderr || stdout}`));
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}
```

### Python script example

```
skills/
  data-analysis/
    plugin.ts        # tool registration
    analyze.py       # python script
    SKILL.md         # skill prompt (optional, separate concern)
```

`skills/data-analysis/plugin.ts`:

```ts
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function runPython(script, args, { timeoutMs = 30_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("python3", [script, ...args], {
      cwd: __dirname,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Python script timed out"));
    }, timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(stderr || `Exit ${code}`));
      else resolve(stdout);
    });
  });
}

export default function (api) {
  api.registerTool({
    name: "analyze_data",
    description: "Run data analysis on a CSV file",
    parameters: {
      type: "object",
      properties: {
        file: { type: "string", description: "Path to CSV file" },
        query: { type: "string", description: "Analysis question" },
      },
      required: ["file", "query"],
    },
    async execute(_id, params) {
      try {
        const result = await runPython(
          join(__dirname, "analyze.py"),
          [params.file, params.query],
        );
        return { content: [{ type: "text", text: result }] };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error: ${err.message}` }],
        };
      }
    },
  });
}
```

`skills/data-analysis/analyze.py`:

```python
import sys
import json

file_path = sys.argv[1]
query = sys.argv[2]

# Do analysis...
result = {"answer": f"Analysis of {file_path}: {query}"}

print(json.dumps(result))
```

### Passing data via stdin

For large inputs, pipe data through stdin instead of arguments:

```ts
function runWithStdin(cmd, args, input, { timeoutMs = 30_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: ["pipe", "pipe", "pipe"],
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
      else resolve(stdout);
    });

    child.stdin.write(input);
    child.stdin.end();
  });
}

// Usage in execute():
const jsonInput = JSON.stringify({ file: params.file, query: params.query });
const result = await runWithStdin("python3", ["analyze.py"], jsonInput);
```

And in Python, read from stdin:

```python
import sys, json
data = json.load(sys.stdin)
```

## Multiple tools from one file

A single `plugin.ts` can register as many tools as you want:

```ts
export default function (api) {
  api.registerTool({
    name: "db_query",
    description: "Run a read-only database query",
    parameters: { /* ... */ },
    async execute(_id, params) { /* ... */ },
  });

  api.registerTool({
    name: "db_insert",
    description: "Insert a record",
    parameters: { /* ... */ },
    async execute(_id, params) { /* ... */ },
  });

  api.registerTool({
    name: "db_schema",
    description: "Show table schemas",
    parameters: { /* ... */ },
    async execute(_id, params) { /* ... */ },
  });
}
```

### Multi-action tool (alternative)

If your tools share a lot of context, use a single tool with an `action` parameter:

```ts
export default function (api) {
  api.registerTool({
    name: "database",
    description: "Database operations: query, insert, or show schema",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["query", "insert", "schema"] },
        table: { type: "string" },
        sql: { type: "string", description: "SQL for query action" },
        record: { type: "object", description: "Data for insert action" },
      },
      required: ["action"],
    },
    async execute(_id, params) {
      switch (params.action) {
        case "query":
          return { content: [{ type: "text", text: await runQuery(params.sql) }] };
        case "insert":
          return { content: [{ type: "text", text: await insertRecord(params.table, params.record) }] };
        case "schema":
          return { content: [{ type: "text", text: await getSchema(params.table) }] };
        default:
          return { content: [{ type: "text", text: `Unknown action: ${params.action}` }] };
      }
    },
  });
}
```

**When to use which:**
- Separate tools: when actions have very different parameters or descriptions
- Single multi-action tool: when they share context and the agent benefits from seeing them as one capability

## Using the plugin API context

The `api` object gives you access to config and logging:

```ts
export default function (api) {
  // Read plugin config (from plugins.entries.skill-tools.config)
  const myConfig = api.pluginConfig;

  // Log messages (visible in gateway logs)
  api.logger.info("Tool loaded");
  api.logger.warn("Something odd");

  // Resolve workspace-relative paths
  const dataDir = api.resolvePath("data");

  // Access full OpenClaw config
  const model = api.config?.agents?.defaults?.model;

  api.registerTool(/* ... */);
}
```

### Tool factory (per-session context)

If your tool needs per-session info (agent ID, workspace dir, sandbox status), register a factory function instead of a static tool:

```ts
export default function (api) {
  api.registerTool(
    (ctx) => {
      // ctx has: config, workspaceDir, agentId, sessionKey, sandboxed, etc.
      if (ctx.sandboxed) return null; // disable in sandbox

      return {
        name: "my_tool",
        description: "...",
        parameters: { /* ... */ },
        async execute(_id, params) {
          // ctx.workspaceDir is available here via closure
          const cwd = ctx.workspaceDir ?? process.cwd();
          // ...
        },
      };
    },
    { name: "my_tool" },
  );
}
```

Returning `null` from a factory disables the tool for that session.

## Error handling

```ts
async execute(_id, params) {
  // Validate inputs early
  const query = typeof params.query === "string" ? params.query.trim() : "";
  if (!query) {
    return { content: [{ type: "text", text: "Error: query is required" }] };
  }

  try {
    const result = await doWork(query);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    // Return errors as text — the agent sees the message and can retry or adapt
    const msg = err instanceof Error ? err.message : String(err);
    return { content: [{ type: "text", text: `Error: ${msg}` }] };
  }
}
```

Throwing an uncaught error from `execute()` also works — the framework catches it and shows the error to the agent. But returning errors as text gives you more control over formatting.

## Do's and don'ts

### Do

- **Name tools with a prefix** that relates to your skill: `myskill_search`, not just `search`. Avoids collisions with core tools or other plugins.
- **Always set a timeout** when spawning processes. Runaway scripts block the agent.
- **Return errors as text content** so the agent can read them and adapt.
- **Keep descriptions concise but precise.** The LLM uses the description to decide when and how to call your tool.
- **Use `__dirname`** (via `import.meta.url`) to locate sibling scripts. Don't assume the working directory.
- **Validate params defensively.** The LLM may send unexpected types or omit fields.
- **Use JSON for script I/O.** Have your Python/Node scripts print JSON to stdout and parse it in the tool.

### Don't

- **Don't use `Type.Union` for string enums** in parameter schemas. Some providers reject `anyOf`/`oneOf`. Use `Type.Unsafe` with `enum` or plain JSON Schema `{ type: "string", enum: [...] }`.
- **Don't use `anyOf`, `oneOf`, or `allOf`** in tool input schemas.
- **Don't name a tool the same as a core tool** (`exec`, `browser`, `message`, `read`, `write`, etc.). The registration will be skipped.
- **Don't use `execSync`** or synchronous child process calls. They block the event loop and freeze the gateway.
- **Don't read large files into memory** and return them as text. Truncate or summarize.
- **Don't hardcode absolute paths.** Use `api.resolvePath()` or `__dirname` for portability.
- **Don't spawn long-lived daemons** from `execute()`. Tools should start, do work, and return. Use `api.registerService()` for background processes.
- **Don't put secrets in tool parameters.** Read them from config (`api.pluginConfig`) or environment variables.
- **Don't forget `required`** in your JSON Schema. Without it, the LLM may omit fields you depend on.
- **Don't return empty content arrays.** Always return at least one content block.

## File structure examples

### Single script

```
skills/
  translate/
    plugin.ts       # registers translate_text tool
    SKILL.md        # optional prompt guidance
```

### Script + helper

```
skills/
  code-review/
    plugin.ts       # registers code_review tool, spawns review.py
    review.py       # does the actual analysis
    SKILL.md
```

### Multi-tool skill

```
skills/
  database/
    plugin.ts       # registers db_query, db_insert, db_schema
    queries.ts      # shared query helpers (imported by plugin.ts)
    SKILL.md
```

### Python project with deps

```
skills/
  ml-predict/
    plugin.ts       # spawns predict.py
    predict.py
    requirements.txt
    venv/           # gitignored; user runs: python3 -m venv venv && venv/bin/pip install -r requirements.txt
    SKILL.md
```

For Python venvs, point spawn at the venv binary:

```ts
const python = join(__dirname, "venv", "bin", "python3");
const result = await run(python, [join(__dirname, "predict.py"), ...args]);
```
