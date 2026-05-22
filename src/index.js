import 'dotenv/config';
import express from 'express';

import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import traceRoutes from './routes/traces.js';
import conflictRoutes from './routes/conflicts.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/auth', authRoutes);
app.use('/users', userRoutes);
app.use('/traces', traceRoutes);
app.use('/conflicts', conflictRoutes);

app.use((_req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
});

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
});

app.listen(PORT, () => {
  console.log(`LandTrace API running on port ${PORT}`);
});
