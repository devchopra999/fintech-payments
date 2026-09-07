require('dotenv').config();
const express = require('express');
const { sequelize } = require('./db');
require('./models/payment');
require('./models/transaction');
const paymentRoutes = require('./routes/payment');

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  const startedAt = Date.now();
  res.on('finish', () => {
    console.log(`[fintech-payments] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - startedAt}ms)`);
  });
  next();
});

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'fintech-payments' }));

app.get('/health/ready', async (req, res) => {
  try {
    await sequelize.authenticate();
    res.json({ status: 'ready' });
  } catch (err) {
    res.status(503).json({ status: 'not-ready', error: err.message });
  }
});

app.use('/', paymentRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
});

const port = process.env.PORT || 4003;

async function start() {
  console.log('fintech-payments starting up');
  await sequelize.authenticate();
  await sequelize.sync();
  app.listen(port, () => console.log(`fintech-payments listening on :${port}`));
}

start().catch((err) => {
  console.error('failed to start fintech-payments', err);
  process.exit(1);
});
