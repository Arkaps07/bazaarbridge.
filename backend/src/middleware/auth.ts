import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { envConfig } from '../config/env';

export interface AuthUser {
  user_id: string;
  name: string;
  email: string;
  role: 'customer' | 'admin' | 'rider';
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function signAuthToken(user: AuthUser): string {
  return jwt.sign(
    {
      user_id: user.user_id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
    envConfig.jwtSecret,
    { expiresIn: '12h' }
  );
}

export function verifyAuthToken(token: string): AuthUser {
  const decoded = jwt.verify(token, envConfig.jwtSecret) as AuthUser;
  return {
    user_id: decoded.user_id,
    name: decoded.name,
    email: decoded.email,
    role: decoded.role,
  };
}

export const SESSION_COOKIE_NAME = 'bazaarbridge_token';

function extractCookieToken(req: Request): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (key === SESSION_COOKIE_NAME) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return null;
}

export function setSessionCookie(res: Response, token: string): void {
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${12 * 60 * 60}`,
  ];
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function clearSessionCookie(res: Response): void {
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
  );
}

function extractRequestToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    return header.slice('Bearer '.length).trim();
  }
  return extractCookieToken(req);
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = extractRequestToken(req);
  if (!token) {
    res.status(401).json({ error: 'UNAUTHORIZED', message: 'Authentication token required.' });
    return;
  }
  try {
    req.user = verifyAuthToken(token);
    next();
  } catch {
    res.status(401).json({ error: 'INVALID_TOKEN', message: 'Session expired or invalid token.' });
  }
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = extractRequestToken(req);
  if (token) {
    try {
      req.user = verifyAuthToken(token);
    } catch {
      // Ignore invalid optional token
    }
  }
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'UNAUTHORIZED', message: 'Authentication required.' });
    return;
  }
  if (req.user.role !== 'admin') {
    res.status(403).json({ error: 'FORBIDDEN', message: 'Administrator role required.' });
    return;
  }
  next();
}

/**
 * In-memory sliding window rate limiter.
 * Used for POST /api/auth/login (10/min/IP per v7.2) and POST /api/shopping-assistant (per user).
 */
export function createRateLimiter(options: {
  maxRequests: number;
  windowMs: number;
  keyFn: (req: Request) => string;
  errorMessage?: string;
}) {
  const hits = new Map<string, number[]>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = options.keyFn(req);
    const now = Date.now();
    const cutoff = now - options.windowMs;
    const recent = (hits.get(key) ?? []).filter((ts) => ts > cutoff);

    if (recent.length >= options.maxRequests) {
      res.status(429).json({
        error: 'RATE_LIMIT_EXCEEDED',
        message: options.errorMessage || 'Too many requests. Please wait a minute and try again.',
      });
      return;
    }

    recent.push(now);
    hits.set(key, recent);
    next();
  };
}

export const loginRateLimiter = createRateLimiter({
  maxRequests: 10,
  windowMs: 60 * 1000,
  keyFn: (req) => req.ip || req.socket.remoteAddress || 'unknown',
  errorMessage: 'Too many login attempts. Please wait 1 minute before trying again.',
});

export const assistantRateLimiter = createRateLimiter({
  maxRequests: 20,
  windowMs: 60 * 1000,
  keyFn: (req) => req.user?.user_id || req.ip || 'anon',
  errorMessage: 'Shopping assistant rate limit reached. Please pause briefly.',
});
