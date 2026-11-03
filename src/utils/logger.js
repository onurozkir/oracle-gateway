import chalk from 'chalk';

export const logger = {
  info: (message, ...args) => {
    console.log(chalk.blue('ℹ info:'), message, ...args);
  },
  success: (message, ...args) => {
    console.log(chalk.green('✔ success:'), message, ...args);
  },
  warn: (message, ...args) => {
    console.warn(chalk.yellow('⚠ warning:'), message, ...args);
  },
  error: (message, ...args) => {
    console.error(chalk.red('✖ error:'), message, ...args);
  },
  debug: (message, ...args) => {
    if (process.env.LOG_LEVEL === 'debug') {
      console.debug(chalk.gray('⚙ debug:'), message, ...args);
    }
  },
};
