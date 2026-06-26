import { describe, it, expect, beforeEach } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { render } from 'ink-testing-library';
import { App } from './App.js';
import { cmdNew, cmdArchive, type Deps } from '../commands.js';
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
    cmdNew({ purpose: 'fix parser bug', dir: '/tmp', slug: 'prs', name: 'Parser' }, deps);
    const { lastFrame } = render(
      <App deps={deps} onAttach={() => {}} onExit={() => {}} />,
    );
    expect(lastFrame()).toMatch(/Parser/);
  });

  it('shows the keybinding hint line', () => {
    const { lastFrame } = render(
      <App deps={deps} onAttach={() => {}} onExit={() => {}} />,
    );
    expect(lastFrame()).toMatch(/attach/);
    expect(lastFrame()).toMatch(/done/);
  });

  it('default view shows active streams and hides archived ones', () => {
    cmdNew({ purpose: 'active stream', dir: '/tmp', slug: 'active-one', name: 'ActiveStream' }, deps);
    cmdNew({ purpose: 'archived stream', dir: '/tmp', slug: 'archived-one', name: 'ArchivedStream' }, deps);
    cmdArchive({ slug: 'archived-one' }, deps);

    const { lastFrame } = render(
      <App deps={deps} onAttach={() => {}} onExit={() => {}} />,
    );
    const frame = lastFrame();
    expect(frame).toMatch(/ActiveStream/);
    expect(frame).not.toMatch(/ArchivedStream/);
    expect(frame).toMatch(/active/);
  });
});
