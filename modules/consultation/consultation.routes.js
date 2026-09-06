import { Router } from "express";
import {
  sessionStatus,
  startSession,
  chat,
  epicrisis,
} from "./consultation.controller.js";
import requireAi from "../../common/middlewares/requireAi.js";

const router = Router();

// requireAi режет ИИ только у тарифа без ИИ (doctor_free). Пациент на
// patient_free проходит — у него ИИ метрованный, а не выключенный, и это
// и есть его продукт. Поэтому гейт стоит на самих вызовах модели
// (сообщение помощнику и генерация эпикриза), а не на всём модуле.
router.get("/session-status", sessionStatus);
router.post("/start", startSession);
router.post("/message", requireAi, chat);
router.post("/epicrisis", requireAi, epicrisis);

export default router;
