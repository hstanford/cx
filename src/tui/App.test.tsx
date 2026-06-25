import { describe, it, expect, beforeEach } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { render } from 'ink-testing-library';
import { App } from './App.js';
import { cmdNew, type Deps } from '../commands.js';
import { type Runner } from '../tmux.js';

const runner: Runner = {
  capture(_c, args) {
    if (args[0] === 'list-windows') return { status: 0, stdout: '' };
    return { status: 0, stdout: '' };
  },
  interactive() { return 0; },
};

let deps: Deps;
beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-'));
  deps = { regPath: path.join(dir, 'registry.json'), runner };
});

describe('App', () => {
  it('lists existing streams by name', () => {
    cmdNew({ purpose: 'refresh triggers', dir: '/tmp', slug: 'trg', name: 'Triggers' }, deps);
    const { lastFrame } = render(
      <App deps={deps} onAttach={() => {}} onExit={() => {}} />,
    );
    expect(lastFrame()).toMatch(/Triggers/);
  });

  it('shows the keybinding hint line', () => {
    const { lastFrame } = render(
      <App deps={deps} onAttach={() => {}} onExit={() => {}} />,
    );
    expect(lastFrame()).toMatch(/attach/);
    expect(lastFrame()).toMatch(/done/);
  });
});
