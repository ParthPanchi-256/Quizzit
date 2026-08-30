const Redis = require('ioredis');

let redisClient = null;

function getRedisClient() {
  if (!redisClient) {
    const url = process.env.REDIS_URL || 'redis://localhost:6379';
    redisClient = new Redis(url);
    redisClient.on('error', (err) => {
      console.error('Unexpected Redis error:', err);
    });
  }
  return redisClient;
}

module.exports = { getRedisClient };
