// routes/UpdatePatientChangePhoneRoute.js
import express from "express";
import { updatePatientChangePhoneController } from "../controllers/UpdatePatientChangePhoneController.js";

const router = express.Router({ mergeParams: true });

/** Лёгкий лог, чтобы видеть, что запрос попал именно сюда */
const hitLogger = (req, _res, next) => {
  try {
    console.log("👉 [patient-profile/change-phone/by-patient] hit", {
      method: req.method,
      url: req.originalUrl,
      userId: req.session?.userId,
      role: req.session?.role,
      bodyKeys: Object.keys(req.body || {}),
    });
  } catch {
    // no-op
  }
  next();
};

/** Нормализуем тело (на случай, если middleware парсера не отработал выше) */
const normalizeBody = (req, _res, next) => {
  if (req.body == null || typeof req.body !== "object") req.body = {};
  next();
};

/** preflight */
router.options("/by-patient", (_req, res) => res.sendStatus(204));

/** основной маршрут — поведение сохранено */
router.post(
  "/by-patient",
  normalizeBody,
  hitLogger,
  updatePatientChangePhoneController
);

/** запретим другие методы на этом пути, чтобы не было «тихих» попаданий */
router.all("/by-patient", (_req, res) =>
  res.status(405).json({ ok: false, message: "Method Not Allowed" })
);

export default router;
