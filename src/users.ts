import { Router } from 'express';
import { prisma } from './db.js';
import { requireAuth, type AuthedRequest } from './middleware.js';
import { toPublicUser } from './shared.js';

export const usersRouter = Router();

// Everything below this line needs a valid token.
usersRouter.use(requireAuth);

// GET /api/users/me  — who am I?
usersRouter.get('/me', async (req: AuthedRequest, res) => {
  const user = await prisma.users.findUnique({ where: { id: req.userId } });
  if (!user) {
    return res.status(404).json({ message: 'Foydalanuvchi topilmadi' });
  }
  res.json(toPublicUser(user));
});

// PATCH /api/users/me  — profile settings
// Send only what changed: { username?, firstName?, lastName?, bio?, avatarColor? }
usersRouter.patch('/me', async (req: AuthedRequest, res) => {
  const me = req.userId as string;
  const { username, firstName, lastName, bio, avatarColor } = req.body ?? {};

  const data: Record<string, string | null> = {};

  if (username !== undefined) {
    const clean = String(username).trim();

    if (!/^[a-zA-Z0-9_]{3,32}$/.test(clean)) {
      return res.status(400).json({
        message: "Username 3-32 ta belgi bo'lsin: harflar, raqamlar va _",
      });
    }

    // Is someone else already using it? (case-insensitive, like Telegram)
    const taken = await prisma.users.findFirst({
      where: { username: { equals: clean, mode: 'insensitive' }, NOT: { id: me } },
    });
    if (taken) {
      return res.status(409).json({ message: 'Bu username band' });
    }

    data.username = clean;
  }

  if (firstName !== undefined) {
    const clean = String(firstName).trim();
    if (clean.length > 64) {
      return res.status(400).json({ message: 'Ism juda uzun' });
    }
    data.first_name = clean || null;
  }

  if (lastName !== undefined) {
    const clean = String(lastName).trim();
    if (clean.length > 64) {
      return res.status(400).json({ message: 'Familiya juda uzun' });
    }
    data.last_name = clean || null;
  }

  if (bio !== undefined) {
    const clean = String(bio).trim();
    if (clean.length > 200) {
      return res.status(400).json({ message: "Bio 200 ta belgidan oshmasin" });
    }
    data.bio = clean || null;
  }

  if (avatarColor !== undefined) {
    const clean = String(avatarColor).trim();
    if (!/^#[0-9a-fA-F]{6}$/.test(clean)) {
      return res.status(400).json({ message: "Rang noto'g'ri" });
    }
    data.avatar_color = clean;
  }

  if (Object.keys(data).length === 0) {
    return res.status(400).json({ message: "O'zgartirish uchun maydon yuboring" });
  }

  try {
    const updated = await prisma.users.update({ where: { id: me }, data });
    res.json(toPublicUser(updated));
  } catch (err: any) {
    if (err.code === 'P2002') {
      return res.status(409).json({ message: 'Bu username band' });
    }
    console.error(err);
    res.status(500).json({ message: 'Server xatosi' });
  }
});

// GET /api/users/search?q=ali  — find people to chat with, like Telegram search
usersRouter.get('/search', async (req: AuthedRequest, res) => {
  const q = String(req.query.q ?? '').trim();

  // Don't return the whole database for an empty box
  if (q.length < 2) {
    return res.json([]);
  }

  const found = await prisma.users.findMany({
    where: {
      // Telegram searches the name as well as the username
      OR: [
        { username: { contains: q, mode: 'insensitive' } },
        { first_name: { contains: q, mode: 'insensitive' } },
        { last_name: { contains: q, mode: 'insensitive' } },
      ],
      NOT: { id: req.userId }, // never show yourself in the results
    },
    orderBy: { username: 'asc' },
    take: 20,
  });

  res.json(found.map(toPublicUser));
});
