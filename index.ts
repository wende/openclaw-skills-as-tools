import { readdirSync, existsSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";

type PluginApi = {
  resolvePath: (input: string) => string;
  logger: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
  };
  registerTool: (tool: unknown, opts?: { optional?: boolean }) => void;
};

/**
 * Walk `dir` recursively looking for files named `plugin.ts`.
 * Returns absolute paths.
 */
function findPluginFiles(dir: string): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findPluginFiles(full));
    } else if (entry.name === "plugin.ts") {
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
    api.logger.info("skill-tools: no plugin.ts files found in skills/");
    return;
  }

  let loaded = 0;
  for (const file of pluginFiles) {
    try {
      const mod = await import(file);
      const fn = mod.default ?? mod.register;

      if (typeof fn === "function") {
        await fn(api);
        loaded++;
        api.logger.info(`skill-tools: loaded ${file}`);
      } else {
        api.logger.warn(`skill-tools: ${file} has no default/register export, skipping`);
      }
    } catch (err) {
      api.logger.warn(`skill-tools: failed to load ${file} — ${err}`);
    }
  }

  api.logger.info(`skill-tools: registered ${loaded}/${pluginFiles.length} skill tool(s)`);
}
