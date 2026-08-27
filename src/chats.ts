import { Router } from 'express';
import { prisma } from './db.js';
import { requireAuth, type AuthedRequest } from './middleware.js';
import { toChatSummary, toMessage } from './shared.js';
import { getIO } from './socket.js';

export const chatsRouter = Router();

chatsRouter.use(requireAuth);

// Is this person actually in this chat? Used before showing or writing anything.
async function getMembership(chatId: string, userId: string) {
  return prisma.chat_members.findUnique({
    where: { chat_id_user_id: { chat_id: chatId, user_id: userId } },
  });
}

const CHAT_INCLUDE = {
  chat_members: { include: { users: true } },
  messages: { orderBy: { created_at: 'desc' as const }, take: 1 },
};

// `membership` is passed in when the caller already has it (e.g. the list
// endpoint, which fetches chat_members rows directly) — avoids a redundant
// lookup and, more importantly, keeps last_read_at correct for unread counts.
async function buildSummary(
  chat: any,
  me: string,
  membership?: { role: string; last_read_at: Date }
) {
  const last = chat.messages[0];
  const mine = membership ?? chat.chat_members.find((cm: any) => cm.user_id === me);

  const unreadCount = await prisma.messages.count({
    where: {
      chat_id: chat.id,
      sender_id: { not: me },
      created_at: { gt: mine?.last_read_at ?? new Date(0) },
    },
  });

  return toChatSummary({
    chat,
    me,
    lastMessage: last?.text ?? '',
    lastMessageAt: (last?.created_at ?? chat.created_at).toISOString(),
    unreadCount,
    myRole: mine?.role ?? 'member',
  });
}

// GET /api/chats  — the list on the left side of the screen (direct + group + channel)
chatsRouter.get('/', async (req: AuthedRequest, res) => {
  const me = req.userId as string;

  const memberships = await prisma.chat_members.findMany({
    where: { user_id: me },
    include: { chats: { include: CHAT_INCLUDE } },
  });

  const summaries = await Promise.all(
    memberships.map((m) => buildSummary(m.chats, me, m))
  );

  // Newest conversation at the top
  summaries.sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));

  res.json(summaries);
});

// POST /api/chats  { username | userId }  — start a direct chat with someone
// If you already have a direct chat with them, you get the existing one back.
chatsRouter.post('/', async (req: AuthedRequest, res) => {
  const me = req.userId as string;
  const { userId, username } = req.body ?? {};

  const other = userId
    ? await prisma.users.findUnique({ where: { id: String(userId) } })
    : username
      ? await prisma.users.findFirst({ where: { username: String(username) } })
      : null;

  if (!other) {
    return res.status(404).json({ message: 'Foydalanuvchi topilmadi' });
  }
  if (other.id === me) {
    return res.status(400).json({ message: "O'zingiz bilan suhbat qura olmaysiz" });
  }

  // A direct chat that has BOTH of us in it
  const existing = await prisma.chats.findFirst({
    where: {
      type: 'direct',
      AND: [
        { chat_members: { some: { user_id: me } } },
        { chat_members: { some: { user_id: other.id } } },
      ],
    },
    include: CHAT_INCLUDE,
  });

  const chat =
    existing && existing.chat_members.length === 2
      ? existing
      : await prisma.chats.create({
          data: {
            type: 'direct',
            chat_members: {
              create: [{ user_id: me }, { user_id: other.id }],
            },
          },
          include: CHAT_INCLUDE,
        });

  res.status(existing ? 200 : 201).json(await buildSummary(chat, me));
});

// POST /api/chats/groups  { title, memberIds: string[] }  — everyone can post
chatsRouter.post('/groups', async (req: AuthedRequest, res) => {
  const me = req.userId as string;
  const title = String(req.body?.title ?? '').trim();
  const memberIds: string[] = Array.isArray(req.body?.memberIds) ? req.body.memberIds : [];
  const uniqueMemberIds = [...new Set(memberIds.map(String))].filter((id) => id !== me);

  if (!title) {
    return res.status(400).json({ message: 'Guruh nomini kiriting' });
  }
  if (uniqueMemberIds.length === 0) {
    return res.status(400).json({ message: "Kamida bitta a'zo tanlang" });
  }

  const chat = await prisma.chats.create({
    data: {
      type: 'group',
      title,
      owner_id: me,
      chat_members: {
        create: [
          { user_id: me, role: 'owner' },
          ...uniqueMemberIds.map((id) => ({ user_id: id, role: 'member' as const })),
        ],
      },
    },
    include: CHAT_INCLUDE,
  });

  res.status(201).json(await buildSummary(chat, me));
});

// POST /api/chats/channels  { title, description?, memberIds?: string[] }
// Only the owner/admins can post — enforced in socket.ts and the POST messages route below.
chatsRouter.post('/channels', async (req: AuthedRequest, res) => {
  const me = req.userId as string;
  const title = String(req.body?.title ?? '').trim();
  const description = req.body?.description ? String(req.body.description).trim() : null;
  const memberIds: string[] = Array.isArray(req.body?.memberIds) ? req.body.memberIds : [];
  const uniqueMemberIds = [...new Set(memberIds.map(String))].filter((id) => id !== me);

  if (!title) {
    return res.status(400).json({ message: 'Kanal nomini kiriting' });
  }

  const chat = await prisma.chats.create({
    data: {
      type: 'channel',
      title,
      description,
      owner_id: me,
      chat_members: {
        create: [
          { user_id: me, role: 'owner' },
          ...uniqueMemberIds.map((id) => ({ user_id: id, role: 'member' as const })),
        ],
      },
    },
    include: CHAT_INCLUDE,
  });

  res.status(201).json(await buildSummary(chat, me));
});

// PATCH /api/chats/:id  { title?, description?, avatarColor? }  — owner/admin only
chatsRouter.patch('/:id', async (req: AuthedRequest, res) => {
  const me = req.userId as string;
  const chatId = req.params.id;
  const membership = await getMembership(chatId, me);

  if (!membership) {
    return res.status(403).json({ message: 'Bu suhbat sizniki emas' });
  }
  if (membership.role === 'member') {
    return res.status(403).json({ message: "Faqat admin yoki egasi o'zgartira oladi" });
  }

  const { title, description, avatarColor } = req.body ?? {};
  const data: Record<string, string | null> = {};
  if (title !== undefined) data.title = String(title).trim();
  if (description !== undefined) data.description = description ? String(description).trim() : null;
  if (avatarColor !== undefined) data.avatar_color = String(avatarColor);

  const chat = await prisma.chats.update({ where: { id: chatId }, data, include: CHAT_INCLUDE });
  res.json(await buildSummary(chat, me, membership));
});

// GET /api/chats/:id/members  — member list with roles, for the group/channel info panel
chatsRouter.get('/:id/members', async (req: AuthedRequest, res) => {
  const me = req.userId as string;
  const chatId = req.params.id;

  if (!(await getMembership(chatId, me))) {
    return res.status(403).json({ message: 'Bu suhbat sizniki emas' });
  }

  const members = await prisma.chat_members.findMany({
    where: { chat_id: chatId },
    include: { users: true },
    orderBy: { joined_at: 'asc' },
  });

  res.json(
    members.map((m) => ({
      role: m.role,
      joinedAt: m.joined_at.toISOString(),
      user: {
        id: m.users.id,
        username: m.users.username,
        firstName: m.users.first_name ?? '',
        lastName: m.users.last_name ?? '',
        avatarColor: m.users.avatar_color,
        status: m.users.status,
      },
    }))
  );
});

// POST /api/chats/:id/members  { userId }  — owner/admin adds someone to a group/channel
chatsRouter.post('/:id/members', async (req: AuthedRequest, res) => {
  const me = req.userId as string;
  const chatId = req.params.id;
  const userId = String(req.body?.userId ?? '');
  const membership = await getMembership(chatId, me);

  if (!membership) {
    return res.status(403).json({ message: 'Bu suhbat sizniki emas' });
  }
  if (membership.role === 'member') {
    return res.status(403).json({ message: "Faqat admin yoki egasi a'zo qo'sha oladi" });
  }
  if (!userId) {
    return res.status(400).json({ message: 'Foydalanuvchi tanlanmagan' });
  }

  try {
    await prisma.chat_members.create({ data: { chat_id: chatId, user_id: userId } });
  } catch (err: any) {
    if (err.code === 'P2002') {
      return res.status(409).json({ message: "Bu foydalanuvchi allaqachon a'zo" });
    }
    throw err;
  }

  res.status(201).json({ ok: true });
});

// DELETE /api/chats/:id/members/:userId  — remove someone, or leave yourself
chatsRouter.delete('/:id/members/:userId', async (req: AuthedRequest, res) => {
  const me = req.userId as string;
  const chatId = req.params.id;
  const targetId = req.params.userId;
  const membership = await getMembership(chatId, me);

  if (!membership) {
    return res.status(403).json({ message: 'Bu suhbat sizniki emas' });
  }
  // Leaving yourself is always allowed; removing someone else needs admin/owner rights.
  if (targetId !== me && membership.role === 'member') {
    return res.status(403).json({ message: "Faqat admin yoki egasi a'zoni chiqara oladi" });
  }

  await prisma.chat_members.delete({
    where: { chat_id_user_id: { chat_id: chatId, user_id: targetId } },
  });

  res.json({ ok: true });
});

// GET /api/chats/:id/messages  — open a conversation
chatsRouter.get('/:id/messages', async (req: AuthedRequest, res) => {
  const me = req.userId as string;
  const chatId = req.params.id;

  if (!(await getMembership(chatId, me))) {
    return res.status(403).json({ message: "Bu suhbat sizniki emas" });
  }

  const rows = await prisma.messages.findMany({
    where: { chat_id: chatId },
    orderBy: { created_at: 'asc' },
    take: 200,
  });

  // Opening the chat means you've read it — this is what clears the unread badge
  await prisma.chat_members.update({
    where: { chat_id_user_id: { chat_id: chatId, user_id: me } },
    data: { last_read_at: new Date() },
  });

  res.json(rows.map(toMessage));
});

// POST /api/chats/:id/messages  { text }  — send without websockets (backup path)
chatsRouter.post('/:id/messages', async (req: AuthedRequest, res) => {
  const me = req.userId as string;
  const chatId = req.params.id;
  const text = String(req.body?.text ?? '').trim();

  if (!text) {
    return res.status(400).json({ message: "Xabar bo'sh" });
  }

  const membership = await getMembership(chatId, me);
  if (!membership) {
    return res.status(403).json({ message: "Bu suhbat sizniki emas" });
  }

  const chat = await prisma.chats.findUnique({ where: { id: chatId } });
  // Channels are broadcast-only: regular members can read but not post.
  if (chat?.type === 'channel' && membership.role === 'member') {
    return res.status(403).json({ message: "Bu kanalda faqat adminlar yoza oladi" });
  }

  const row = await prisma.messages.create({
    data: { chat_id: chatId, sender_id: me, text },
  });

  const message = toMessage(row);

  // Tell everyone sitting in this chat right now
  getIO()?.to(chatId).emit('message:new', message);

  res.status(201).json(message);
});
