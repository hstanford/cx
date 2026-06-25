import { parseArgs } from 'node:util';
import { cmdNew, cmdLs, cmdGo, cmdDone, cmdEdit, cmdRm, cmdOpen, cmdRestart, type Deps } from './commands.js';

export function runCli(argv: string[], deps: Deps): { output?: string; launchTui?: boolean } {
  const [cmd, ...rest] = argv;
  if (!cmd) return { launchTui: true };

  switch (cmd) {
    case 'new': {
      const { values, positionals } = parseArgs({
        args: rest, allowPositionals: true,
        options: { dir: { type: 'string' }, slug: { type: 'string' }, name: { type: 'string' } },
      });
      const purpose = positionals.join(' ').trim();
      if (!purpose) throw new Error('usage: cx new "<purpose>" [--dir .] [--slug x] [--name n]');
      const s = cmdNew({ purpose, dir: values.dir ?? process.cwd(), slug: values.slug, name: values.name }, deps);
      return { output: `started "${s.name}" in the background — open it in the Claude app (claude.ai/code), or \`cx go ${s.slug}\` to attach here` };
    }
    case 'ls':
      return { output: cmdLs(deps) };
    case 'go': {
      const slug = requireSlug(rest, 'go');
      cmdGo({ slug }, deps);
      return {};
    }
    case 'done': {
      const slug = requireSlug(rest, 'done');
      cmdDone({ slug }, deps);
      return { output: `stopped "${slug}" (kept)` };
    }
    case 'edit': {
      const { values, positionals } = parseArgs({
        args: rest, allowPositionals: true,
        options: { purpose: { type: 'string' }, name: { type: 'string' } },
      });
      const slug = positionals[0];
      if (!slug) throw new Error('usage: cx edit <slug> [--purpose ...] [--name ...]');
      const s = cmdEdit({ slug, purpose: values.purpose, name: values.name }, deps);
      return { output: `updated "${s.slug}"` };
    }
    case 'rm': {
      const slug = requireSlug(rest, 'rm');
      cmdRm({ slug }, deps);
      return { output: `removed "${slug}"` };
    }
    case 'open': {
      const slug = requireSlug(rest, 'open');
      const r = cmdOpen({ slug }, deps);
      return { output: r.opened === 'session'
        ? `opening "${slug}" in your browser`
        : `couldn't capture the session URL yet — opened claude.ai/code (find "${slug}" by name); try again once it's live` };
    }
    case 'restart': {
      const { values, positionals } = parseArgs({ args: rest, allowPositionals: true, options: { all: { type: 'boolean' } } });
      const r = cmdRestart({ slug: positionals[0], all: values.all }, deps);
      return { output: r.restarted.length === 0
        ? 'nothing to restart'
        : `restarted ${r.restarted.length}: ${r.restarted.join(', ')}` };
    }
    default:
      throw new Error(`unknown command: ${cmd}`);
  }
}

function requireSlug(rest: string[], verb: string): string {
  const slug = rest[0];
  if (!slug) throw new Error(`usage: cx ${verb} <slug>`);
  return slug;
}
