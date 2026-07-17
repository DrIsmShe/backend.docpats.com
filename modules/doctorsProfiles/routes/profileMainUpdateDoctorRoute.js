import { Router } from "express";
import profileMainUpdateDoctorController from "../controllers/profileMainUpdateDoctorController.js";
import authMiddleware from "../../../common/middlewares/authvalidateMiddleware/authMiddleware.js";

const router = Router();

// ⚠️ БЕЗОПАСНОСТЬ: раньше роут был без auth, а контроллер брал userId из тела —
// любой аноним мог перезаписать чужой профиль (IDOR). Теперь требуем сессию;
// контроллер правит ТОЛЬКО req.userId (владельца сессии).
router.post("/", authMiddleware, profileMainUpdateDoctorController);

export default router;
