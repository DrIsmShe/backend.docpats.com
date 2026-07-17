import { Router } from "express";
import getMyMedicalHistoryDetailsController from "../controllers/getMyMedicalHistoryDetailsController.js";
import authMiddleware from "../../../common/middlewares/authMiddleware.js";
const router = Router();

// ⚠️ БЕЗОПАСНОСТЬ: раньше роут был без auth, а контроллер читал историю
// болезни по :id без проверки владельца — любой аноним мог прочитать чужую
// историю (диагноз, ФИО/пол/дата рождения). Теперь требуем сессию + владельца.
router.get("/:id", authMiddleware, getMyMedicalHistoryDetailsController);

export default router;
