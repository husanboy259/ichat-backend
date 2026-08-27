import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import { prisma } from './db.js';

export const authRouter = Router();

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// ---------- REGISTER ----------
authRouter.post('/register', async (req, res) => {
  const { username, phone, password } = req.body ?? {};

  if (!username || !phone || !password) {
    return res.status(400).json({ message: "Barcha maydonlarni to'ldiring" });
  }

  const cleanPhone = String(phone).replace(/\D/g, '');
  if (!/^998\d{9}$/.test(cleanPhone)) {
    return res.status(400).json({ message: "Telefon raqam noto'g'ri" });
  }

  if (String(password).length < 6) {
    return res.status(400).json({ message: 'Parol kamida 6 ta belgi' });
  }

  try {
    const passwordHash = await bcrypt.hash(String(password), 10);

    const user = await prisma.users.create({
      // trim() matters: without it "Ali " and "Ali" become two different people
      data: {
        username: String(username).trim(),
        phone: cleanPhone,
        password_hash: passwordHash,
      },
    });

    const token = jwt.sign(
      { userId: user.id },
      process.env.JWT_SECRET as string,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      token,
      user: { id: user.id, username: user.username, phone: user.phone },
    });
  } catch (err: any) {
    if (err.code === 'P2002') {
      return res.status(409).json({ message: "Bu raqam allaqachon ro'yxatdan o'tgan" });
    }
    console.error(err);
    res.status(500).json({ message: 'Server xatosi' });
  }
});

// ---------- LOGIN ----------
authRouter.post('/login', async (req, res) => {
  const { phone, password } = req.body ?? {};

  if (!phone || !password) {
    return res.status(400).json({ message: 'Telefon va parolni kiriting' });
  }

  // Same cleaning as register, or "+998 90..." would never match "99890..."
  const cleanPhone = String(phone).replace(/\D/g, '');

  const user = await prisma.users.findFirst({ where: { phone: cleanPhone } });

  // No user, or a Google-only account with no password set
  if (!user || !user.password_hash) {
    return res.status(401).json({ message: "Telefon yoki parol noto'g'ri" });
  }

  const ok = await bcrypt.compare(String(password), user.password_hash);
  if (!ok) {
    // Same message on purpose — never reveal which half was wrong
    return res.status(401).json({ message: "Telefon yoki parol noto'g'ri" });
  }

  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET as string, {
    expiresIn: '7d',
  });

  res.json({
    token,
    user: { id: user.id, username: user.username, phone: user.phone },
  });
});

// ---------- GOOGLE ----------
authRouter.post('/google', async (req, res) => {
  const { idToken } = req.body ?? {};
  if (!idToken) {
    return res.status(400).json({ message: 'idToken kerak' });
  }

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload?.sub) {
      return res.status(401).json({ message: "Google token noto'g'ri" });
    }

    const googleId = payload.sub;
    const email = payload.email ?? null;
    const name = payload.name || email?.split('@')[0] || 'User';

    let user = await prisma.users.findFirst({ where: { google_id: googleId } });

    if (!user && email) {
      const byEmail = await prisma.users.findFirst({ where: { email } });
      if (byEmail) {
        user = await prisma.users.update({
          where: { id: byEmail.id },
          data: { google_id: googleId },
        });
      }
    }

    if (!user) {
      user = await prisma.users.create({
        data: { username: name, email, google_id: googleId },
      });
    }

    const token = jwt.sign(
      { userId: user.id },
      process.env.JWT_SECRET as string,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: { id: user.id, username: user.username, phone: user.phone },
    });
  } catch (err) {
    console.error(err);
    res.status(401).json({ message: 'Google orqali kirishda xatolik' });
  }
});
