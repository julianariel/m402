#!/usr/bin/env node
// `m402 deposit <amount>` and `m402 call <url>` land in #9 — see ../../docs/design.md#7-agent.

const [, , command] = process.argv;

switch (command) {
  default:
    console.error('usage: m402 <deposit|call> ...');
    process.exit(1);
}
