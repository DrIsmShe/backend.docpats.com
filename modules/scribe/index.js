// server/modules/scribe/index.js
// ─────────────────────────────────────────────────────────────────────
//   Запись приёма: врач говорит с пациентом, карта пишется сама.
//
//   Монтируется как /api/v1/scribe, ПОСЛЕ session-middleware: обе
//   стороны опознаются по req.session.userId, и без этого модуль не
//   имеет смысла — авторство реплик и есть его суть.
//
//   Куски аудио идут через memoryStorage и НИКУДА не сохраняются:
//   распознаются на лету, в базу попадает только текст. Разговор врача
//   с пациентом — это PHI в чистом виде, и хранилища записей приёмов у
//   нас нет намеренно.
// ─────────────────────────────────────────────────────────────────────

import express from "express";
import multer from "multer";
import * as ctrl from "./controllers/scribe.controller.js";

const router = express.Router();

function requireUser(req, res, next) {
  if (!req.session?.userId) {
    return res
      .status(401)
      .json({ success: false, message: "Требуется вход в аккаунт" });
  }
  next();
}

// 12 МБ на кусок: двадцать секунд opus-аудио занимают около 40 КБ, так
// что предел здесь не для нормальной работы, а против отправки в этот
// маршрут чего-то другого.
const chunkUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024, files: 1 },
});

router.use(requireUser);

router.post("/sessions", ctrl.startController);
// ПЕРЕД /sessions/:id — иначе express примет "by-room" за идентификатор
// и вернёт 404 на каждый запрос пациента.
router.get("/sessions/by-room/:room", ctrl.byRoomController);
router.get("/sessions/:id", ctrl.statusController);
router.post("/sessions/:id/consent", ctrl.consentController);
router.post("/sessions/:id/revoke", ctrl.revokeController);
router.post("/sessions/:id/chunks", chunkUpload.single("audio"), ctrl.chunkController);
router.post("/sessions/:id/finish", ctrl.finishController);
// Перевод черновика на язык карты. Отдельным действием, а не при
// сборке: врач должен знать, что перед ним перевод.
router.post("/sessions/:id/translate", ctrl.translateController);

export default router;
