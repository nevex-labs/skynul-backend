import { Command } from 'commander';
import { render } from 'ink';
import React from 'react';
import { SkynulClient } from './api-client.js';
import { Cli } from './cli.js';

const program = new Command();

program
  .name('skynul')
  .description('SKYNUL - Your everyday agent')
  .version('2.0.0')
  .option('-u, --url <url>', 'Backend URL', process.env.SKYNUL_API_URL || 'http://127.0.0.1:3141')
  .option('-t, --token <token>', 'API token (or set SKYNUL_API_TOKEN)', process.env.SKYNUL_API_TOKEN)
  .action((opts) => {
    const client = new SkynulClient(opts.url, opts.token);
    render(<Cli client={client} />);
  });

program.parse();
