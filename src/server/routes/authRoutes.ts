import { Router } from "express";
import { register, login, logout, me } from "../controllers/authController";

const router = Router();

router.post("/register", register);
router.post("/login", login);
router.post("/logout", logout);
router.get("/me", me);

export default router;
