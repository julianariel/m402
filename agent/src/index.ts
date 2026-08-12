#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { loadAgentConfig } from './config.js';
import { callCommand } from './commands/call.js';
import { depositCommand } from './commands/deposit.js';
import { initCommand, type InitOptions } from './commands/init.js';
import { redeemCommand } from './commands/redeem.js';
import { parseServiceType, servicesCommand } from './commands/services.js';
import { toCliError } from './errors.js';
import { Output } from './output.js';

const VERSION = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string;
}).version;

const HELP = `m402 - private agentic payments on Midnight

Usage:
  m402 init [options]
  m402 services [options]
  m402 deposit <amount-star> [options]
  m402 call <gateway-url> [options]
  m402 redeem <amount-mstar> [options]

The happy path, in order:
  1. m402 init --new         generate a wallet, fund it, register it for DUST
  2. m402 deposit <amount>   fund shielded credit from your NIGHT balance
  3. m402 services --json    find a service and its ready-to-run call URL
  4. m402 call <url>         pay privately; the resource lands on stdout

Run 'm402 init' (no flags) on an existing wallet first if you already have one. It submits
nothing; it syncs the wallet and reports what you hold, so the one-off multi-minute sync
happens when you choose rather than inside your first payment. One deposit covers many
calls - the wallet splits a larger coin and takes change.

Examples:
  m402 init --new
  m402 services --json
  m402 deposit 5000 --vault 17b4cf...
  m402 call http://127.0.0.1:8787/s/a7f2
  m402 call http://127.0.0.1:8787/s/a7f2 --dry-run
  m402 redeem 1000 --yes

Common options:
  --vault <hex>            Vault override (then M402_VAULT_ADDRESS)
  --network <name>         local, preview, or preprod (default: preview)
  --mnemonic-file <path>   Path to wallet words; never pass the words themselves
  --env-file <path>        Environment file (default: agent/.env)
  --state-file <path>      Receipt state file (default: ~/.m402/<network>.json)
  --gateway <url>          Gateway override (then M402_GATEWAY_URL, then config.json)
  --json                   Machine-readable output
  --quiet                  Suppress progress messages
  --no-color               Disable terminal colors
  --debug                  Print unexpected stack traces
  -h, --help               Show help
  --version                Show version

Init options:
  --new                     Generate a wallet, fund it from the faucet, register it for DUST
  --import <path>           Use an existing mnemonic file instead of generating one
  --force                   Overwrite an existing wallet at the default location
  --no-faucet               Skip the automatic faucet drip (--new/--import only)

Services options:
  --type <origin|relay>    Filter by fulfilment type

Call options:
  --dry-run                Fetch and display the 402 without paying
  --allow-other-vault      Accept a gateway vault that differs from configured vault
  --fresh                  Bypass recovery after confirming the old receipt did not land

Redeem options:
  --yes                    Skip the interactive confirmation

Exit codes — branch on this, not on stderr text:
  0   resource delivered on stdout                             proceed
  1   unexpected failure                                       do not retry blindly; re-run with --debug
  2   configuration or usage error                              fix config; retrying cannot help
  3   operational error (proof server down, credit already      resolve the named cause, then retry
      spent, another operation holding the lock)
  4   gateway/network unreachable, or wallet sync timed out     retry with backoff
In --json mode, errors print to stdout as {"error": {"message", "code", "retryable", "hint"}}
instead of stderr text — "code" is a stable identifier, "retryable" says whether re-running
the same command unmodified could plausibly succeed.
`;

function ensureSupportedNode(): void {
  const major = Number(process.versions.node.split('.')[0]);
  if (major !== 22 && major !== 24) {
    throw new Error(`m402 requires Node 22 or 24; found ${process.versions.node}. Run 'nvm use'.`);
  }
}

const COMMANDS = ['init', 'services', 'deposit', 'call', 'redeem'] as const;

async function main(args: string[]): Promise<void> {
  ensureSupportedNode();

  if (args.includes('--version')) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  if (!args.length || args.includes('--help') || args.includes('-h') || args[0] === 'help') {
    process.stdout.write(HELP);
    return;
  }

  const parsed = parseArgs({
    args,
    allowPositionals: true,
    strict: true,
    options: {
      vault: { type: 'string' },
      network: { type: 'string' },
      'mnemonic-file': { type: 'string' },
      'env-file': { type: 'string' },
      'state-file': { type: 'string' },
      gateway: { type: 'string' },
      type: { type: 'string' },
      json: { type: 'boolean', default: false },
      quiet: { type: 'boolean', short: 'q', default: false },
      'no-color': { type: 'boolean', default: false },
      debug: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      'allow-other-vault': { type: 'boolean', default: false },
      fresh: { type: 'boolean', default: false },
      yes: { type: 'boolean', short: 'y', default: false },
      new: { type: 'boolean', default: false },
      import: { type: 'string' },
      force: { type: 'boolean', default: false },
      'no-faucet': { type: 'boolean', default: false },
    },
  });

  const [command, argument, ...extra] = parsed.positionals;
  if (!command || !(COMMANDS as readonly string[]).includes(command)) {
    throw new Error(`Unknown command '${command ?? ''}'. Run m402 --help.`);
  }
  if (command === 'init' && argument) {
    throw new Error(`init takes no arguments; received '${argument}'.`);
  }
  if (command === 'init' && parsed.values.new && parsed.values.import) {
    throw new Error('--new and --import are mutually exclusive.');
  }
  if (command === 'services' && argument) {
    throw new Error(`services takes no arguments; use --type <origin|relay>. Received '${argument}'.`);
  }
  if (extra.length) throw new Error(`${command} received unexpected arguments: ${extra.join(' ')}`);

  if (parsed.values.debug) process.env['M402_DEBUG'] = '1';
  const output = new Output({
    json: parsed.values.json,
    quiet: parsed.values.quiet,
    noColor: parsed.values['no-color'],
  });
  const config = loadAgentConfig({
    envFile: parsed.values['env-file'],
    network: parsed.values.network,
    vaultAddress: parsed.values.vault,
    mnemonicFile: parsed.values['mnemonic-file'],
    stateFile: parsed.values['state-file'],
    gatewayUrl: parsed.values.gateway,
  });

  switch (command) {
    case 'init': {
      const initOptions: InitOptions = parsed.values.import
        ? {
            mode: 'import',
            importFile: parsed.values.import,
            force: parsed.values.force,
            noFaucet: parsed.values['no-faucet'],
          }
        : parsed.values.new
          ? { mode: 'new', force: parsed.values.force, noFaucet: parsed.values['no-faucet'] }
          : { mode: 'warm' };
      await initCommand(config, output, initOptions);
      break;
    }
    case 'services':
      await servicesCommand(config, output, { type: parseServiceType(parsed.values.type) });
      break;
    case 'deposit':
      await depositCommand(argument, config, output);
      break;
    case 'call':
      await callCommand(argument, config, output, {
        dryRun: parsed.values['dry-run'],
        allowOtherVault: parsed.values['allow-other-vault'],
        fresh: parsed.values.fresh,
      });
      break;
    case 'redeem':
      await redeemCommand(argument, config, output, parsed.values.yes);
      break;
  }
}

const rawArgs = process.argv.slice(2);

main(rawArgs).catch((error: unknown) => {
  const cliError = toCliError(error);
  // Scanned the same way --version/--help are above, rather than threaded out of main(): an
  // error can happen before or during parseArgs, so this must not depend on parseArgs having
  // succeeded.
  if (rawArgs.includes('--json')) {
    process.stdout.write(`${JSON.stringify({ error: cliError.toJSON() }, null, 2)}\n`);
  } else {
    process.stderr.write(`Error: ${cliError.message}\n`);
    if (cliError.hint) process.stderr.write(`${cliError.hint}\n`);
  }
  if (process.env['M402_DEBUG'] && error instanceof Error && error.stack) {
    process.stderr.write(`${error.stack}\n`);
  }
  process.exitCode = cliError.exitCode;
});
