#!/usr/bin/env node
import { runCli } from '../src/cli.js';
import { registryPath } from '../src/paths.js';
import { defaultRunner } from '../src/tmux.js';
import { launchTui } from '../src/tui/launch.js';

try {
  const res = runCli(process.argv.slice(2), { regPath: registryPath(), runner: defaultRunner });
  if (res.launchTui) {
    await launchTui({ regPath: registryPath(), runner: defaultRunner });
  } else if (res.output) {
    console.log(res.output);
  }
} catch (err) {
  console.error(`cx: ${(err as Error).message}`);
  process.exit(1);
}
