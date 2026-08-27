import 'dotenv/config';
import http from 'node:http';
import express from 'express';
import cors from 'cors';
import { authRouter } from './auth.js';
import { usersRouter } from './users.js';
import { chatsRouter } from './chats.js';
import { foldersRouter } from './folders.js';
import { initSocket } from './socket.js';

const app = express();

const allowedOrigins = (process.env.CORS_ORIGIN ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(cors({ origin: allowedOrigins }));
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/chats', chatsRouter);
app.use('/api/folders', foldersRouter);

// Express and Socket.IO share one server, so both live on the same port.
const server = http.createServer(app);
initSocket(server, allowedOrigins);

const port = Number(process.env.PORT) || 4000;
server.listen(port, () => {
  console.log(`Backend running on http://localhost:${port}`);
});
