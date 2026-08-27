// The walkie-talkie. Express answers one question at a time; this stays open
// so a message can arrive without anybody asking for it.
import { Server as IOServer } from 'socket.io';
import type { Server as HttpServer } from 'node:http';
import { prisma } from './db.js';
import { readToken } from './middleware.js';
import { toMessage } from './shared.js';

let io: IOServer | null = null;

// Routes use this to shout a message to everyone in a chat.
export function getIO() {
  return io;
}

export function initSocket(server: HttpServer, allowedOrigins: string[]) {
  io = new IOServer(server, {
    cors: { origin: allowedOrigins },
  });

  // Same check as requireAuth, but the token arrives in the handshake,
  // not in a header — that's how lib/socket.ts sends it.
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Token yubormadingiz'));

    try {
      socket.data.userId = readToken(String(token));
      next();
    } catch {
      next(new Error('Token yaroqsiz'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.data.userId as string;
    console.log('socket connected:', userId);

    // Walk into a conversation room
    socket.on('join_chat', async (chatId: unknown) => {
      const id = String(chatId ?? '');
      if (!id) return;

      const member = await prisma.chat_members.findUnique({
        where: { chat_id_user_id: { chat_id: id, user_id: userId } },
      });

      // Without this check, anyone could listen to any conversation
      if (member) socket.join(id);
    });

    // Send a message
    socket.on('message:send', async (payload: any) => {
      const chatId = String(payload?.chatId ?? '');
      const text = String(payload?.text ?? '').trim();
      if (!chatId || !text) return;

      const member = await prisma.chat_members.findUnique({
        where: { chat_id_user_id: { chat_id: chatId, user_id: userId } },
      });
      if (!member) return;

      // Channels are broadcast-only: regular members can read but not post.
      if (member.role === 'member') {
        const chat = await prisma.chats.findUnique({ where: { id: chatId } });
        if (chat?.type === 'channel') return;
      }

      const row = await prisma.messages.create({
        data: { chat_id: chatId, sender_id: userId, text },
      });

      // Goes to everyone in the room — including the sender, so both
      // screens show exactly the same message from the database
      io?.to(chatId).emit('message:new', toMessage(row));
    });

    socket.on('disconnect', () => {
      console.log('socket disconnected:', userId);
    });
  });

  return io;
}
