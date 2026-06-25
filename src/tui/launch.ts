import React from 'react';
import { render } from 'ink';
import { App } from './App.js';
import { cmdGo, type Deps } from '../commands.js';

export async function launchTui(deps: Deps): Promise<void> {
  const isTty = process.stdout.isTTY;
  if (isTty) process.stdout.write('\x1b[?1049h');
  let pendingAttach: string | null = null;
  try {
    const app = render(
      React.createElement(App, {
        deps,
        onAttach: (slug: string) => { pendingAttach = slug; },
        onExit: () => {},
      }),
    );
    await app.waitUntilExit();
  } finally {
    if (isTty) process.stdout.write('\x1b[?1049l');
  }
  if (pendingAttach) cmdGo({ slug: pendingAttach }, deps);
}
