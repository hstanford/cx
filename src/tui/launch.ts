import React from 'react';
import { render } from 'ink';
import { App } from './App.js';
import { cmdGo, cmdNew, type Deps } from '../commands.js';

export async function launchTui(deps: Deps): Promise<void> {
  let pendingAttach: string | null = null;
  let pendingCreate: string | null = null;
  const app = render(
    React.createElement(App, {
      deps,
      onAttach: (slug: string) => { pendingAttach = slug; },
      onCreate: (purpose: string) => { pendingCreate = purpose; },
      onExit: () => {},
    }),
  );
  await app.waitUntilExit();
  if (pendingCreate) cmdNew({ purpose: pendingCreate, dir: process.cwd() }, deps);
  else if (pendingAttach) cmdGo({ slug: pendingAttach }, deps);
}
