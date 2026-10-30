#!/usr/bin/env node
// Seed Watcher command. The library holds the behaviour; this file only starts it.
import { runCli } from '../lib.mjs';

runCli(process.argv.slice(2)).then((code) => {
  process.exitCode = code ?? 0;
}).catch(() => {
  process.stderr.write('The watcher hit an unexpected error.\n');
  process.exitCode = 1;
});
