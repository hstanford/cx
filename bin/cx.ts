#!/usr/bin/env node
import { runCli } from '../src/cli.js';
import { registryPath } from '../src/paths.js';
import { defaultRunner } from '../src/tmux.js';
import { launchTui } from '../src/tui/launch.js';
import { listen } from '../src/listen.js';

const deps = { regPath: registryPath(), runner: defaultRunner };

try {
  if (process.argv[2] === 'listen') {
    await listen(deps);
  } else {
    const res = runCli(process.argv.slice(2), deps);
    if (res.launchTui) {
      await launchTui(deps);
    } else if (res.output) {
      console.log(res.output);
    }
  }
} catch (err) {
  console.error(`cx: ${(err as Error).message}`);
  process.exit(1);
}
