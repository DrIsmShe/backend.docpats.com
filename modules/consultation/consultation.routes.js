import { Router } from "express";
import {
  sessionStatus,
  startSession,
  chat,
  epicrisis,
} from "./consultation.controller.js";

const router = Router();

router.get("/session-status", sessionStatus);
router.post("/start", startSession);
router.post("/message", chat);
router.post("/epicrisis", epicrisis);

export default router;
