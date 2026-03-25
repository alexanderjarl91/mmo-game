import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import crypto from "crypto";
import { createServer } from "http";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { GameRoom } from "./GameRoom";
import {
  createUser, getUserByEmail, getUserById,
  createCharacter, getCharactersByUserId, getCharacterById,
  countCharactersByUserId, getCharacterByName, deleteCharacter,
  setResetToken, clearResetToken, updateUserPassword,
} from "./db";

const JWT_SECRET = process.env.JWT_SECRET || "mmo-dev-secret-change-in-prod";
const JWT_EXPIRY = "7d";
const MAX_CHARACTERS = 10;

const app = express();
app.use(cors());
app.use(express.json());

// ── Auth Middleware ──

interface AuthRequest extends Request {
  userId?: number;
  userEmail?: string;
}

function authMiddleware(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authorization required" });
    return;
  }
  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { userId: number; email: string };
    req.userId = payload.userId;
    req.userEmail = payload.email;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

// ── Auth Routes ──

app.post("/api/register", (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    // Validate email
    if (!email || typeof email !== "string") {
      return res.status(400).json({ error: "Email is required" });
    }
    const trimmedEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      return res.status(400).json({ error: "Invalid email format" });
    }

    // Validate password
    if (!password || typeof password !== "string" || password.length < 4) {
      return res.status(400).json({ error: "Password must be at least 4 characters" });
    }

    // Check if email taken
    const existing = getUserByEmail(trimmedEmail);
    if (existing) {
      return res.status(409).json({ error: "Email already registered" });
    }

    // Create user (no character yet)
    const hash = bcrypt.hashSync(password, 10);
    const userId = createUser(trimmedEmail, hash);

    // Return JWT
    const token = jwt.sign({ userId, email: trimmedEmail }, JWT_SECRET, { expiresIn: JWT_EXPIRY });

    return res.json({ token, characters: [] });
  } catch (err: any) {
    console.error("Register error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/login", (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const user = getUserByEmail(email.trim().toLowerCase());
    if (!user) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    if (!bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const characters = getCharactersByUserId(user.id);
    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: JWT_EXPIRY });

    return res.json({
      token,
      characters: characters.map((c) => ({
        id: c.id,
        name: c.name,
        class: c.class,
        level: c.level,
        isHardcore: !!c.is_hardcore,
      })),
    });
  } catch (err: any) {
    console.error("Login error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── Character Routes (protected) ──

app.get("/api/characters", authMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const characters = getCharactersByUserId(req.userId!);
    return res.json({
      characters: characters.map((c) => ({
        id: c.id,
        name: c.name,
        class: c.class,
        level: c.level,
        isHardcore: !!c.is_hardcore,
      })),
    });
  } catch (err: any) {
    console.error("Get characters error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/characters", authMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const { name, playerClass, isHardcore } = req.body;

    // Check max characters
    const count = countCharactersByUserId(req.userId!);
    if (count >= MAX_CHARACTERS) {
      return res.status(400).json({ error: `Maximum ${MAX_CHARACTERS} characters per account` });
    }

    // Validate name (3-20 chars, alphanumeric + spaces)
    if (!name || typeof name !== "string") {
      return res.status(400).json({ error: "Character name is required" });
    }
    const trimmedName = name.trim();
    if (trimmedName.length < 3 || trimmedName.length > 20) {
      return res.status(400).json({ error: "Name must be 3-20 characters" });
    }
    if (!/^[a-zA-Z0-9 ]+$/.test(trimmedName)) {
      return res.status(400).json({ error: "Name must be alphanumeric (spaces allowed)" });
    }

    // Validate class
    const validClasses = ["warrior", "ranger", "mage", "rogue"];
    if (!validClasses.includes(playerClass)) {
      return res.status(400).json({ error: "Invalid class" });
    }

    // Check name uniqueness
    const existingChar = getCharacterByName(trimmedName);
    if (existingChar) {
      return res.status(409).json({ error: "Character name already taken" });
    }

    // Create character
    const charId = createCharacter(req.userId!, trimmedName, playerClass, !!isHardcore);

    return res.json({
      character: {
        id: charId,
        name: trimmedName,
        class: playerClass,
        level: 1,
        isHardcore: !!isHardcore,
      },
    });
  } catch (err: any) {
    console.error("Create character error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

app.delete("/api/characters/:id", authMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const charId = parseInt(req.params.id, 10);
    if (isNaN(charId)) {
      return res.status(400).json({ error: "Invalid character ID" });
    }

    const char = getCharacterById(charId);
    if (!char) {
      return res.status(404).json({ error: "Character not found" });
    }
    if (char.user_id !== req.userId!) {
      return res.status(403).json({ error: "Not your character" });
    }

    deleteCharacter(charId);
    return res.json({ success: true });
  } catch (err: any) {
    console.error("Delete character error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── Password Reset Routes ──

app.post("/api/forgot-password", (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    if (!email || typeof email !== "string") {
      return res.status(400).json({ error: "Email is required" });
    }

    // Always return success (don't leak whether email exists)
    const successMsg = { message: "If that email exists, a reset code has been sent." };

    const user = getUserByEmail(email.trim().toLowerCase());
    if (!user) {
      return res.json(successMsg);
    }

    // Generate 6-digit code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const codeHash = crypto.createHash("sha256").update(code).digest("hex");
    const expiresAt = Math.floor(Date.now() / 1000) + 900; // 15 minutes

    setResetToken(user.id, codeHash, expiresAt);

    // Log to console since we don't have email sending
    console.log(`[PASSWORD RESET] Code for ${user.email}: ${code}`);

    return res.json(successMsg);
  } catch (err: any) {
    console.error("Forgot password error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/reset-password", (req: Request, res: Response) => {
  try {
    const { email, token, newPassword } = req.body;

    if (!email || !token || !newPassword) {
      return res.status(400).json({ error: "Email, token, and new password are required" });
    }
    if (typeof newPassword !== "string" || newPassword.length < 4) {
      return res.status(400).json({ error: "Password must be at least 4 characters" });
    }

    const user = getUserByEmail(email.trim().toLowerCase());
    if (!user || !user.reset_token || !user.reset_token_expires) {
      return res.status(400).json({ error: "Invalid or expired reset code" });
    }

    // Check expiry
    const now = Math.floor(Date.now() / 1000);
    if (now > user.reset_token_expires) {
      clearResetToken(user.id);
      return res.status(400).json({ error: "Reset code has expired" });
    }

    // Verify token hash
    const tokenHash = crypto.createHash("sha256").update(token.trim()).digest("hex");
    if (tokenHash !== user.reset_token) {
      return res.status(400).json({ error: "Invalid reset code" });
    }

    // Update password
    const hash = bcrypt.hashSync(newPassword, 10);
    updateUserPassword(user.id, hash);
    clearResetToken(user.id);

    return res.json({ message: "Password updated successfully" });
  } catch (err: any) {
    console.error("Reset password error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

const httpServer = createServer(app);

const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

gameServer.define("game", GameRoom);

const PORT = 2567;
httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`🎮 Game server running on http://localhost:${PORT}`);
});
