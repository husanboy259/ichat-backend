// Chat folders — like Telegram's "All Chats" + custom tabs. Purely personal:
// a folder belongs to one user and just points at chats that user is already in.
import { Router } from 'express';
import { prisma } from './db.js';
import { requireAuth, type AuthedRequest } from './middleware.js';

export const foldersRouter = Router();

foldersRouter.use(requireAuth);

// GET /api/folders  — each folder plus the chat ids sitting inside it
foldersRouter.get('/', async (req: AuthedRequest, res) => {
  const me = req.userId as string;

  const folders = await prisma.folders.findMany({
    where: { user_id: me },
    include: { folder_chats: true },
    orderBy: { position: 'asc' },
  });

  res.json(
    folders.map((f) => ({
      id: f.id,
      name: f.name,
      position: f.position,
      chatIds: f.folder_chats.map((fc) => fc.chat_id),
    }))
  );
});

// POST /api/folders  { name }
foldersRouter.post('/', async (req: AuthedRequest, res) => {
  const me = req.userId as string;
  const name = String(req.body?.name ?? '').trim();

  if (!name) {
    return res.status(400).json({ message: 'Papka nomini kiriting' });
  }
  if (name.length > 32) {
    return res.status(400).json({ message: 'Papka nomi juda uzun' });
  }

  const count = await prisma.folders.count({ where: { user_id: me } });
  const folder = await prisma.folders.create({
    data: { user_id: me, name, position: count },
  });

  res.status(201).json({ id: folder.id, name: folder.name, position: folder.position, chatIds: [] });
});

// Only the owner of a folder may touch it.
async function ownedFolder(id: string, userId: string) {
  return prisma.folders.findFirst({ where: { id, user_id: userId } });
}

// PATCH /api/folders/:id  { name?, position? }
foldersRouter.patch('/:id', async (req: AuthedRequest, res) => {
  const me = req.userId as string;
  const folder = await ownedFolder(req.params.id, me);
  if (!folder) return res.status(404).json({ message: 'Papka topilmadi' });

  const { name, position } = req.body ?? {};
  const data: Record<string, string | number> = {};
  if (name !== undefined) data.name = String(name).trim();
  if (position !== undefined) data.position = Number(position);

  const updated = await prisma.folders.update({ where: { id: folder.id }, data });
  res.json({ id: updated.id, name: updated.name, position: updated.position });
});

// DELETE /api/folders/:id
foldersRouter.delete('/:id', async (req: AuthedRequest, res) => {
  const me = req.userId as string;
  const folder = await ownedFolder(req.params.id, me);
  if (!folder) return res.status(404).json({ message: 'Papka topilmadi' });

  await prisma.folders.delete({ where: { id: folder.id } });
  res.json({ ok: true });
});

// POST /api/folders/:id/chats  { chatId }  — add a chat you're a member of to this folder
foldersRouter.post('/:id/chats', async (req: AuthedRequest, res) => {
  const me = req.userId as string;
  const folder = await ownedFolder(req.params.id, me);
  if (!folder) return res.status(404).json({ message: 'Papka topilmadi' });

  const chatId = String(req.body?.chatId ?? '');
  const member = await prisma.chat_members.findUnique({
    where: { chat_id_user_id: { chat_id: chatId, user_id: me } },
  });
  if (!member) {
    return res.status(403).json({ message: 'Bu suhbat sizniki emas' });
  }

  try {
    await prisma.folder_chats.create({ data: { folder_id: folder.id, chat_id: chatId } });
  } catch (err: any) {
    if (err.code === 'P2002') return res.status(200).json({ ok: true }); // already there
    throw err;
  }

  res.status(201).json({ ok: true });
});

// DELETE /api/folders/:id/chats/:chatId
foldersRouter.delete('/:id/chats/:chatId', async (req: AuthedRequest, res) => {
  const me = req.userId as string;
  const folder = await ownedFolder(req.params.id, me);
  if (!folder) return res.status(404).json({ message: 'Papka topilmadi' });

  await prisma.folder_chats
    .delete({ where: { folder_id_chat_id: { folder_id: folder.id, chat_id: req.params.chatId } } })
    .catch(() => {}); // already gone — fine

  res.json({ ok: true });
});
