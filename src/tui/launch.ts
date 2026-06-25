import React from 'react';
import { render } from 'ink';
import { App } from './App.js';
import { cmdGo, type Deps } from '../commands.js';

export async function launchTui(deps: Deps): Promise<void> {
  let pendingAttach: string | null = null;
  const app = render(
    React.createElement(App, {
      deps,
      onAttach: (slug: string) => { pendingAttach = slug; },
      onExit: () => {},
    }),
  );
  await app.waitUntilExit();
  if (pendingAttach) cmdGo({ slug: pendingAttach }, deps);
}
