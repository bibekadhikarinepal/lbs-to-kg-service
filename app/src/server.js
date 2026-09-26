const express = require('express');
const redisClient = require('./redisClient');
const { convertLbsToKg, LBS_TO_KG_FACTOR } = require('./convert');

const PORT = Number(process.env.PORT || 3000);
const CONVERSIONS_KEY = 'conversions';

const app = express();

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.get('/convert', async (req, res) => {
  const result = convertLbsToKg(req.query.lbs);

  if (!result.ok) {
    return res.status(result.status).json({ error: result.error });
  }

  try {
    await redisClient.incr(CONVERSIONS_KEY);
  } catch (err) {
    console.error('[convert] failed to increment conversions counter:', err.message);
    return res.status(503).json({ error: 'Storage unavailable, please retry' });
  }

  return res.status(200).json({
    lbs: result.lbs,
    kg: result.kg,
    formula: `kg = lbs * ${LBS_TO_KG_FACTOR}`,
  });
});

app.get('/stats', async (req, res) => {
  try {
    const value = await redisClient.get(CONVERSIONS_KEY);
    res.status(200).json({ conversions: value ? Number(value) : 0 });
  } catch (err) {
    console.error('[stats] failed to read conversions counter:', err.message);
    res.status(503).json({ error: 'Storage unavailable, please retry' });
  }
});

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

async function start() {
  await redisClient.connect();
  app.listen(PORT, () => {
    console.log(`[server] lbs-to-kg service listening on port ${PORT}`);
  });
}

start().catch((err) => {
  console.error('[server] failed to start:', err);
  process.exit(1);
});
