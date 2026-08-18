import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from './db.js';

export const authRouter = Router();

authRouter.post('/register', async (req, res) => {
  const { username, phone, password } = req.body ?? {};

  // 1 — is anything missing?
  if (!username || !phone || !password) {
    return res.status(400).json({ message: "Barcha maydonlarni to'ldiring" });
  }

  // 2 — clean the phone: "+998 90 123 45 67" → "998901234567"
  const cleanPhone = String(phone).replace(/\D/g, '');
  if (!/^998\d{9}$/.test(cleanPhone)) {
    return res.status(400).json({ message: "Telefon raqam noto'g'ri" });
  }

  if (String(password).length < 6) {
    return res.status(400).json({ message: 'Parol kamida 6 ta belgi' });
  }

  try {
    // 3 — scramble the password (never save the real one)
    const passwordHash = await bcrypt.hash(String(password), 10);

    // 4 — write the user into Supabase
    const user = await prisma.users.create({
      data: { username, phone: cleanPhone, password_hash: passwordHash },
    });

    // 5 — make the ticket
    const token = jwt.sign(
      { userId: user.id },
      process.env.JWT_SECRET as string,
      { expiresIn: '7d' }
    );

    // 6 — answer in the shape the frontend expects
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
