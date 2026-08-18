import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { authRouter } from './auth.js';      // ← NEW

const app = express();

app.use(cors({ origin: process.env.CORS_ORIGIN }));
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

app.use('/api/auth', authRouter);             // ← NEW

const port = Number(process.env.PORT) || 4000;
app.listen(port, () => {
  console.log(`Backend running on http://localhost:${port}`);
});
