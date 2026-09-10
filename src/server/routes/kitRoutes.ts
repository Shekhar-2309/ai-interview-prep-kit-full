import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import * as kitController from "../controllers/kitController";

const router = Router();
router.use(requireAuth);

router.post("/", kitController.createKit);
router.post("/batch", kitController.createKitsBatch);
router.get("/", kitController.listKits);
router.get("/:id", kitController.getKit);
router.get("/:id/runs/:runId/stream", kitController.streamKitProgress);

router.patch("/:id/brief", kitController.editBrief);
router.patch("/:id/questions/:questionId", kitController.editQuestion);
router.delete("/:id/questions/:questionId", kitController.deleteQuestion);
router.patch("/:id/questions/:questionId/category", kitController.moveQuestion);
router.put("/:id/categories/:category/order", kitController.reorderQuestions);
router.post("/:id/questions", kitController.addQuestion);

router.patch("/:id/flashcards/:flashcardId", kitController.editFlashcard);
router.delete("/:id/flashcards/:flashcardId", kitController.deleteFlashcard);
router.post("/:id/flashcards", kitController.addFlashcard);

router.post("/:id/regenerate", kitController.regenerateSection);

router.get("/:id/weak-spots", kitController.getWeakSpots);
router.post("/:id/practice/record", kitController.recordPracticeConfidence);
router.get("/:id/practice/session", kitController.getPracticeSession);

export default router;
