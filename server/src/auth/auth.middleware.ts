import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export interface AuthPayload {
  sub: string;
  email: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

export function requireAuth(jwtSecret: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Missing or malformed token" });
      return;
    }

    const token = header.slice(7);

    try {
      const payload = jwt.verify(token, jwtSecret) as AuthPayload;
      req.user = payload;
      next();
    } catch {
      res.status(401).json({ error: "Invalid or expired token" });
    }
  };
}
