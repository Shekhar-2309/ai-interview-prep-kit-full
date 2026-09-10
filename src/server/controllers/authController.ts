import { Request, Response } from "express";
import { registerUser, verifyCredentials } from "../services/authService";
import { RegisterRequestSchema, LoginRequestSchema } from "../validation/requestSchemas";
import { asyncHandler } from "../middleware/errorHandler";

export const register = asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = RegisterRequestSchema.parse(req.body);
  const user = await registerUser(email, password);
  req.session.userId = user._id.toString();
  res.status(201).json({ user: { id: user._id, email: user.email } });
});

export const login = asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = LoginRequestSchema.parse(req.body);
  const user = await verifyCredentials(email, password);
  req.session.userId = user._id.toString();
  res.json({ user: { id: user._id, email: user.email } });
});

export const logout = asyncHandler(async (req: Request, res: Response) => {
  req.session.destroy((err) => {
    if (err) {
      res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "failed to log out" } });
      return;
    }
    res.clearCookie("connect.sid");
    res.status(204).send();
  });
});

export const me = asyncHandler(async (req: Request, res: Response) => {
  if (!req.session?.userId) {
    res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "not signed in" } });
    return;
  }
  res.json({ userId: req.session.userId });
});
