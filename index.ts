import { readdirSync, existsSync, lstatSync, statSync } from "node:fs";
import { join, resolve, relative } from "node:path";

type PluginApi = {
  resolvePath: (input: string) => string;
  logger: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
  };
  registerTool: (tool: unknown, opts?: { optional?: boolean }) => void;
};

const PLUGIN_FILE = /^plugin\.[tj]s$/;

// Directories that should never be descended into.
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "__pycache__",
  "venv",
  ".venv",
  "dist",
  ".next",
]);

/**
 * Walk `dir` recursively looking for plugin.ts / plugin.js files.
 * Skips dependency/build directories and symlinks.
 */
function findPluginFiles(dir: string): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;

    const full = join(dir, entry.name);

    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) {
        results.push(...findPluginFiles(full));
      }
    } else if (PLUGIN_FILE.test(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

export default async function register(api: PluginApi) {
  const skillsDir = resolve(api.resolvePath("skills"));

  if (!existsSync(skillsDir) || !statSync(skillsDir).isDirectory()) {
    api.logger.info("skill-tools: no skills/ directory found, skipping");
    return;
  }

  const pluginFiles = findPluginFiles(skillsDir);

  if (pluginFiles.length === 0) {
    api.logger.info("skill-tools: no plugin files found in skills/");
    return;
  }

  let loaded = 0;
  for (const file of pluginFiles) {
    const rel = relative(skillsDir, file);
    try {
      const mod = await import(file);
      const fn = mod.default ?? mod.register;

      if (typeof fn === "function") {
        await fn(api);
        loaded++;
        api.logger.info(`skill-tools: loaded skills/${rel}`);
      } else {
        api.logger.warn(`skill-tools: skills/${rel} has no default/register export, skipping`);
      }
    } catch (err) {
      api.logger.warn(`skill-tools: failed to load skills/${rel} — ${err}`);
    }
  }

  api.logger.info(`skill-tools: registered ${loaded}/${pluginFiles.length} skill tool(s)`);
}
