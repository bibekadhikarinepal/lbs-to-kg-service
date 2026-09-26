const { createClient } = require('redis');

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = Number(process.env.REDIS_PORT || 6379);

const client = createClient({
  socket: {
    host: REDIS_HOST,
    port: REDIS_PORT,
    reconnectStrategy: (retries) => Math.min(retries * 100, 3000),
  },
  disableOfflineQueue: true,
});

client.on('error', (err) => {
  console.error('[redis] client error:', err.message);
});

client.on('reconnecting', () => {
  console.warn(`[redis] reconnecting to ${REDIS_HOST}:${REDIS_PORT}...`);
});

client.on('connect', () => {
  console.log(`[redis] connected to ${REDIS_HOST}:${REDIS_PORT}`);
});

module.exports = client;
