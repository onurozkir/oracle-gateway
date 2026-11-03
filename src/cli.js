import { Command } from 'commander';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { logger } from './utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const packageJson = JSON.parse(readFileSync(path.resolve(__dirname, '../package.json'), 'utf-8'));

export async function runCLI(argv = process.argv) {
  const program = new Command();

  program
    .name('oracle-gateway')
    .description(packageJson.description)
    .version(packageJson.version, '-v, --version', 'output the current version');

  // status command
  program
    .command('status')
    .description('Check the status of the Oracle Gateway connection and environment')
    .action(async () => {
      logger.info('Checking Oracle Gateway status...');
      logger.info(`Environment: ${config.env}`);
      logger.info(`Gateway Target: http://${config.gateway.host}:${config.gateway.port}`);
      logger.success('CLI operational and ready.');
    });

  // config command
  program
    .command('config')
    .description('Show current configuration (sensitive fields masked)')
    .action(() => {
      const sanitized = {
        ...config,
        apiKey: config.apiKey ? '***' + config.apiKey.slice(-4) : '(not set)',
        oracle: {
          ...config.oracle,
          password: config.oracle.password ? '********' : '(not set)',
        },
      };
      console.log(JSON.stringify(sanitized, null, 2));
    });

  await program.parseAsync(argv);
}
