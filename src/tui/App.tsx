import React, { useState } from 'react';
import { Box, Text, useInput, useApp, useStdout } from 'ink';
import TextInput from 'ink-text-input';
import { useStreams } from './useStreams.js';
import { cmdNew, cmdDone, cmdRm, cmdOpen, cmdRestart, type Deps } from '../commands.js';

type Props = {
  deps: Deps;
  onAttach: (slug: string) => void;
  onExit: () => void;
};

export function App({ deps, onAttach, onExit }: Props): JSX.Element {
  const streams = useStreams(deps);
  const { exit } = useApp();
  const { stdout } = useStdout();
  const terminalHeight = stdout?.rows;
  const [cursor, setCursor] = useState(0);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState('');

  const clamp = (i: number) => Math.max(0, Math.min(streams.length - 1, i));
  const current = streams[clamp(cursor)];

  useInput((input, key) => {
    if (creating) return;
    if (input === 'q') { onExit(); exit(); return; }
    if (key.upArrow) setCursor(c => clamp(c - 1));
    if (key.downArrow) setCursor(c => clamp(c + 1));
    if (key.return && current) { onAttach(current.slug); exit(); return; }
    if (input === 'n') { setDraft(''); setCreating(true); }
    if (input === 'g' && current) cmdOpen({ slug: current.slug }, deps);
    if (input === 'r' && current) cmdRestart({ slug: current.slug }, deps);
    if (input === 'd' && current) cmdDone({ slug: current.slug }, deps);
    if (input === 'x' && current) cmdRm({ slug: current.slug }, deps);
  });

  if (creating) {
    return (
      <Box flexDirection="column">
        <Text>new stream purpose:</Text>
        <TextInput
          value={draft}
          onChange={setDraft}
          onSubmit={(value) => {
            const purpose = value.trim();
            if (purpose) cmdNew({ purpose, dir: process.cwd(), attach: false }, deps);
            setCreating(false);
          }}
        />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" height={terminalHeight}>
      <Box flexDirection="column" flexGrow={1}>
        {streams.length === 0 && <Text dimColor>no streams yet — press n to start one</Text>}
        {streams.map((s, i) => (
          <Text key={s.slug} inverse={i === clamp(cursor)}>
            {s.status === 'running' ? '●' : '○'} {s.slug.padEnd(14)} {s.name.padEnd(20)} {s.purpose}
          </Text>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>↑↓ move  ⏎ attach  g open  r restart  n new  d done  x remove  q quit</Text>
      </Box>
    </Box>
  );
}
