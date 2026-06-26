import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { cmdNew, cmdLs, cmdGo, cmdDone, cmdEdit, cmdRm, cmdOpen, cmdRestart, cmdArchive, cmdRestore, type Deps } from './commands.js';

const USAGE = `cx — a control plane for many Claude Code sessions

  cx                                   live TUI (↑↓ move · ⏎ attach · n new · g open · r restart · d stop · x archive · q quit)
  cx new "<purpose>" [opts]            start a named, remote-controlled session
      --prompt "<text>"                  send an initial message to the session
      --prompt-file <path>               read the initial message from a file
      --dir <path>                       working directory (default: current)
      --slug <slug>  --name "<name>"     override the generated slug / display name
  cx ls [--archived | --all]           list streams (running first; archived hidden by default)
  cx go <slug>                         attach; revives a stopped one (context intact)
  cx open <slug>                       open the session in your browser
  cx restart <slug> | --all            re-launch with current config; history intact
  cx done <slug>                       stop but keep
  cx archive <slug>                    hide a stream (stops it if live)
  cx restore <slug>                    un-hide a stream and revive it (context intact)
  cx edit <slug> [--purpose ..] [--name ..]   update the label
  cx rm <slug>                         hard delete from the registry
  cx listen                            run the MCP dispatch daemon (cx_spawn / cx_list)
  cx help                              show this help`;

export function runCli(argv: string[], deps: Deps): { output?: string; launchTui?: boolean } {
  const [cmd, ...rest] = argv;
  if (!cmd) return { launchTui: true };
  if (cmd === 'help' || cmd === '--help' || cmd === '-h') return { output: USAGE };

  switch (cmd) {
    case 'new': {
      const { values, positionals } = parseArgs({
        args: rest, allowPositionals: true,
        options: {
          dir: { type: 'string' }, slug: { type: 'string' }, name: { type: 'string' },
          prompt: { type: 'string' }, 'prompt-file': { type: 'string' },
        },
      });
      const purpose = positionals.join(' ').trim();
      if (!purpose) throw new Error('usage: cx new "<purpose>" [--prompt "<text>" | --prompt-file <path>] [--dir .] [--slug x] [--name n]');
      const seed = values['prompt-file'] ? fs.readFileSync(values['prompt-file'], 'utf8') : values.prompt;
      const s = cmdNew({ purpose, dir: values.dir ?? process.cwd(), slug: values.slug, name: values.name, seed }, deps);
      return { output: `started "${s.name}"${seed ? ' with an initial prompt' : ''} in the background — open it in the Claude app (claude.ai/code), or \`cx go ${s.slug}\` to attach here` };
    }
    case 'ls': {
      const { values } = parseArgs({
        args: rest, allowPositionals: false,
        options: { archived: { type: 'boolean' }, all: { type: 'boolean' } },
      });
      return { output: cmdLs(deps, { archived: values.archived, all: values.all }) };
    }
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
    case 'archive': {
      const slug = requireSlug(rest, 'archive');
      cmdArchive({ slug }, deps);
      return { output: `archived "${slug}"` };
    }
    case 'restore': {
      const slug = requireSlug(rest, 'restore');
      const { revived } = cmdRestore({ slug }, deps);
      return { output: revived ? `restored "${slug}" — back up and running` : `restored "${slug}"` };
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
      throw new Error(`unknown command: ${cmd}\n\n${USAGE}`);
  }
}

function requireSlug(rest: string[], verb: string): string {
  const slug = rest[0];
  if (!slug) throw new Error(`usage: cx ${verb} <slug>`);
  return slug;
}
