// server/modules/video/routes/video.routes.js
//
// Маршруты каталога видео. Монтируются в главном index.js как
//   app.use("/api/v1/video", videoRoutes)
// ПОСЛЕ session-middleware и tenantMiddleware: актёр собирается из сессии,
// клиника — из tenant-контекста, если он есть.
//
// ПОРЯДОК ОБЪЯВЛЕНИЯ. Конкретные подпути идут до "/:id", иначе "/public"
// был бы прочитан как идентификатор ролика и отвечал бы 404 вместо витрины.
//
// ПРАВА. Грубой проверки по роли на маршруте нет намеренно: право на ролик
// определяется прежде всего владением, а его знает только сервис. Роль
// добавляет доступ к роликам клиники и проверяется там же, через canFor.

import express from "express";
import { requireSession } from "../../../common/middlewares/requireSession.js";
import { asyncHandler } from "../../../common/middlewares/errorHandler.js";
import * as ctrl from "../controllers/video.controller.js";
import * as consent from "../controllers/videoConsent.controller.js";
import * as playlist from "../controllers/videoPlaylist.controller.js";
import { проверитьПодписьСтудии } from "../studioCallback.js";
import { applyStudioRender } from "../services/video.service.js";
import { studioCallbackSchema } from "../validators/video.schemas.js";
import { ValidationError } from "../../../common/utils/errors.js";

const router = express.Router();

/* ── Витрина: единственный маршрут без входа ────────────────────── */
router.get("/public", ctrl.listPublicController);
// Страница ролика и канал клиники — тоже без входа. Объявлены здесь, до
// requireSession: ниже начинается закрытая часть модуля.
router.get("/public/clinic/:clinicId", ctrl.listClinicPublicController);
router.get("/public/:id/playback", ctrl.publicPlaybackController);
router.get("/public/:id", ctrl.getPublicVideoController);

/* ── Вебхук студии: без сессии, но с подписью ───────────────────── */
router.post(
  "/studio/callback",
  проверитьПодписьСтудии,
  asyncHandler(async (req, res) => {
    const parsed = studioCallbackSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError("Validation failed", {
        issues: parsed.error.issues.map((i) => ({
          path: i.path,
          message: i.message,
        })),
      });
    }
    const video = await applyStudioRender(parsed.data);
    res.json({ id: video._id, status: video.status });
  }),
);

/* ── Всё остальное — только для вошедших ────────────────────────── */
router.use(requireSession);

// ── Видео-согласие ────────────────────────────────────────────────
// Объявлено ДО "/:id": иначе "consents" было бы прочитано как
// идентификатор ролика, и весь раздел отвечал бы 404.
router.post("/consents", consent.requestConsentController);
router.get("/consents/my", consent.listMyConsentsController);
router.get("/consents/patient/:clinicPatientId", consent.listPatientConsentsController);
router.get("/consents/:id", consent.getConsentController);
router.post("/consents/:id/sign", consent.signConsentController);
router.post("/consents/:id/revoke", consent.revokeConsentController);

// ── Планы подготовки ──────────────────────────────────────────────
// Тоже до "/:id" и по той же причине, что и согласия.
router.post("/playlists", playlist.createPlaylistController);
router.get("/playlists", playlist.listPlaylistsController);
router.post("/playlists/assign", playlist.assignPlaylistController);
router.get("/playlists/my", playlist.listMyAssignmentsController);
router.get("/playlists/patient/:clinicPatientId", playlist.listPatientAssignmentsController);
router.get("/playlists/appointment/:appointmentId", playlist.listAppointmentAssignmentsController);
router.post("/playlists/assignments/:id/cancel", playlist.cancelAssignmentController);
router.post("/playlists/:id/deactivate", playlist.deactivatePlaylistController);

router.get("/", ctrl.listVideosController);
router.post("/", ctrl.createVideoController);

// Ролики, прикреплённые к сущности. Объявлено до "/:id".
router.get("/for/:entityType/:entityId", ctrl.listForEntityController);

// Воспроизведение: ссылка на файл и доклад о просмотре.
router.get("/:id/playback", ctrl.playbackController);
router.post("/:id/watch", ctrl.watchController);

// Расход и пакеты минут.
router.get("/quota", ctrl.quotaController);
router.post("/quota/buy", ctrl.buyMinutesController);

// Машинная сборка: заявка и решение врача по сценарию.
router.post("/generate", ctrl.draftFromDataController);
router.post("/:id/review/approve", ctrl.approveGeneratedController);
router.post("/:id/review/reject", ctrl.rejectGeneratedController);

// Визитка врача. "intro" без идентификатора — снятие, поэтому объявлено
// до "/:id/..." шаблонов.
router.post("/intro/clear", ctrl.clearIntroController);
router.post("/:id/intro", ctrl.setIntroController);

router.post("/:id/publish", ctrl.publishVideoController);
router.post("/:id/unpublish", ctrl.unpublishVideoController);
router.post("/:id/attach", ctrl.attachVideoController);
router.post("/:id/detach", ctrl.detachVideoController);

router.get("/:id", ctrl.getVideoController);
router.patch("/:id", ctrl.updateVideoController);
router.delete("/:id", ctrl.deleteVideoController);

export default router;
