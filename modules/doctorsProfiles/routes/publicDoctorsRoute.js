// server/modules/doctorsProfiles/routes/publicDoctorsRoute.js
//
// Публичные (без авторизации) роуты врачей для SEO-страниц.
// Монтируется ДО session: app.use("/api/v1/public", publicDoctorsRouter)

import { Router } from "express";
import { getPublicTopDoctors } from "../controllers/publicTopDoctors.controller.js";
import { getPublicCompetence } from "../controllers/competence.controller.js";

const router = Router();

router.get("/top-doctors", getPublicTopDoctors);

// Учебная активность врача. Публичный маршрут: пациент выбирает врача
// до входа в систему, и прятать за авторизацией то, что врач сам решил
// показать, незачем. Врач, показ не включивший, отдаёт null.
router.get("/doctors/:id/competence", getPublicCompetence);

export default router;
