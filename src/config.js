import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env file from project root
dotenv.config({ path: path.resolve(__dirname, '../.env') });

export const config = {
  env: process.env.NODE_ENV || 'development',
  logLevel: process.env.LOG_LEVEL || 'info',
  gateway: {
    host: process.env.GATEWAY_HOST || 'localhost',
    port: parseInt(process.env.GATEWAY_PORT || '8080', 10),
    timeoutMs: parseInt(process.env.GATEWAY_TIMEOUT_MS || '5000', 10),
  },
  apiKey: process.env.API_KEY || '',
  oracle: {
    connectString: process.env.ORACLE_CONNECT_STRING || '',
    user: process.env.ORACLE_USER || '',
    password: process.env.ORACLE_PASSWORD || '',
  },
};
