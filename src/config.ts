import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { cxHome } from './paths.js';

export const ConfigSchema = z.object({ claudeArgs: z.array(z.string()).default([]) });
export type Config = z.infer<typeof ConfigSchema>;

export function configPath(): string {
  return path.join(cxHome(), 'config.json');
}

export function loadConfig(): Config {
  const file = configPath();
  if (!fs.existsSync(file)) return { claudeArgs: [] };
  try {
    return ConfigSchema.parse(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    return { claudeArgs: [] };
  }
}
