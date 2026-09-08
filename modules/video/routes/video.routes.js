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
import * as adminCtrl from "../controllers/videoAdmin.controller.js";
import requireAdmin from "../../admin/middlewares/authvalidateMiddleware/requireAdmin.js";
import { проверитьПодписьСтудии } from "../studioCallback.js";
import { applyStudioRender } from "../services/video.service.js";
import { studioCallbackSchema } from "../validators/video.schemas.js";
import { ValidationError } from "../../../common/utils/errors.js";

const router = express.Router();

/* ── Витрина: единственный маршрут без входа ────────────────────── */
router.get("/public", ctrl.listPublicController);
// Лента «по интересам». Без сессии — свежее; с сессией — подобранное.
router.get("/recommended", ctrl.recommendedController);
// Страница ролика и канал клиники — тоже без входа. Объявлены здесь, до
// requireSession: ниже начинается закрытая часть модуля.
// Где теперь фильм студии — для переадресации старых ссылок.
router.get("/public/by-studio/:filmId", ctrl.byStudioFilmController);
router.get("/public/clinic/:clinicId", ctrl.listClinicPublicController);
router.get("/public/:id/playback", ctrl.publicPlaybackController);
// Похожие — до "/public/:id", иначе путь разберётся как идентификатор.
router.get("/public/:id/related", ctrl.relatedController);
// Просмотр гостя. Без сессии: витрина открыта всем, и считать только
// вошедших значит показывать неправду на каждой карточке.
router.post("/public/:id/view", ctrl.publicViewController);
// Разделы витрины — открыто: по ним строятся чипсы ленты.
// Встраивание: страница плеера для чужого сайта и код для вставки.
// Обе — без сессии; страница плеера сама снимает запрет на фрейм.
router.get("/embed/:id", ctrl.embedPageController);
router.get("/public/:id/embed", ctrl.embedCodeController);

router.get("/categories", ctrl.categoriesController);

// Правила публикации — открыто: их читают до того, как решают загружать.
router.get("/upload/rules", ctrl.uploadRulesController);
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

// ── Администратор платформы ───────────────────────────────────────
// Своя ветка с requireAdmin: он сам ходит в базу и сверяет role="admin".
// Объявлена до "/:id", иначе "admin" было бы прочитано как идентификатор.
//
// Создание ролика админом отдельного маршрута не требует: обычный POST "/"
// заводит ролик от его имени, а дальше он правит и публикует его теми же
// админскими действиями.
// Разделы: их состав — решение владельца площадки, а не разработчика,
// поэтому меняются из админки, а не выкаткой кода.
router.get("/admin/categories", requireAdmin, adminCtrl.adminCategoriesController);
router.post("/admin/categories", requireAdmin, adminCtrl.createCategoryController);
router.patch("/admin/categories/:id", requireAdmin, adminCtrl.updateCategoryController);
router.delete("/admin/categories/:id", requireAdmin, adminCtrl.deleteCategoryController);

// Очередь жалоб. Строго до "/admin/:id": иначе "reports" будет
// разобран как идентификатор ролика и список ответит 404.
router.get("/admin/reports", requireAdmin, ctrl.listReportsController);
router.post("/admin/reports/:id/resolve", requireAdmin, ctrl.resolveReportController);

router.get("/admin", requireAdmin, adminCtrl.adminListController);
router.get("/admin/:id", requireAdmin, adminCtrl.adminGetController);
router.patch("/admin/:id", requireAdmin, adminCtrl.adminUpdateController);
router.post("/admin/:id/archive", requireAdmin, adminCtrl.adminArchiveController);
router.post("/admin/:id/unarchive", requireAdmin, adminCtrl.adminUnarchiveController);
router.delete("/admin/:id", requireAdmin, adminCtrl.adminDeleteController);

// Загрузка своего файла: заявка со ссылками и подтверждение по факту.
router.post("/upload/prepare", ctrl.prepareUploadController);
router.post("/upload/complete", ctrl.completeUploadController);

// Перенос готового фильма из студии. Стоит до "/:id", иначе "import" будет
// разобран как идентификатор ролика.
router.post("/import/studio", ctrl.importStudioController);

// Жалоба на ролик или комментарий — от любого вошедшего.
router.post("/reports", ctrl.reportController);

// Подписки на каналы врачей и клиник.
router.get("/subscriptions", ctrl.mySubscriptionsController);
router.post("/subscriptions/toggle", ctrl.subscribeController);

// Отметки под роликом.
// Субтитры из речи и перевод на выбранные языки.
router.post("/:id/transcribe", ctrl.transcribeController);

router.post("/:id/like", ctrl.likeController);
router.post("/:id/dislike", ctrl.dislikeController);

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
