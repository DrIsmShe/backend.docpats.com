import { Router } from "express";
import profileMainUpdatePatientController from "../controllers/profileMainUpdatePatientController.js";
import authMiddleware from "../../../common/middlewares/authMiddleware.js";

const router = Router();

// ⚠️ БЕЗОПАСНОСТЬ: раньше без auth, userId брался из тела → любой аноним мог
// перезаписать профиль любого пациента (IDOR). Теперь только владелец сессии.
router.post("/", authMiddleware, profileMainUpdatePatientController);

export default router;
