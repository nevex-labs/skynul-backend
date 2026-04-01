import { Command } from 'commander';
import { render } from 'ink';
import React from 'react';
import { SkynulClient } from './api-client.js';
import { Dashboard } from './components/dashboard.js';

const program = new Command();

program
  .name('skynul')
  .description('Skynul devtools — monitor tasks, channels & system stats')
  .version('0.0.1')
  .option('-u, --url <url>', 'Skynul backend URL', 'http://127.0.0.1:3141')
  .option('-t, --token <token>', 'API bearer token (or set SKYNUL_API_TOKEN)')
  .option('-p, --poll <ms>', 'Poll interval in ms', '3000')
  .action((opts) => {
    const client = new SkynulClient(opts.url, opts.token);
    const pollMs = Number.parseInt(opts.poll, 10);

    render(React.createElement(Dashboard, { client, pollMs }));
  });

program.parse();
