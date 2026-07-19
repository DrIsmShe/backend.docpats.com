// server/modules/doctorsProfiles/routes/publicDoctorsRoute.js
//
// Публичные (без авторизации) роуты врачей для SEO-страниц.
// Монтируется ДО session: app.use("/api/v1/public", publicDoctorsRouter)

import { Router } from "express";
import { getPublicTopDoctors } from "../controllers/publicTopDoctors.controller.js";

const router = Router();

router.get("/top-doctors", getPublicTopDoctors);

export default router;
