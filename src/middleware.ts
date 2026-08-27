// The security guard. Every protected route goes through here first.
import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthedRequest extends Request {
  userId?: string;
}

// Read a token and find out who it belongs to. Throws if the token is fake or expired.
export function readToken(token: string): string {
  const payload = jwt.verify(token, process.env.JWT_SECRET as string) as {
    userId: string;
  };
  return payload.userId;
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ message: 'Token yubormadingiz' });
  }

  try {
    req.userId = readToken(token);
    next();
  } catch {
    return res.status(401).json({ message: 'Token yaroqsiz yoki muddati tugagan' });
  }
}
