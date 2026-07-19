import { Router } from "express";
import { createNotificationController } from "./controllers/createNotificationController.js";
import { getNotificationsController } from "./controllers/getNotificationsController.js";
import { markAsReadController } from "./controllers/markAsReadController.js";
import { deleteNotificationController } from "./controllers/deleteNotificationController.js";

import { getPatientNotificationsController } from "./controllers/getPatientNotificationsController.js";
import { markSinglePatientNotificationAsReadController } from "./controllers/markSinglePatientNotificationAsReadController.js";
import { markAllPatientNotificationsAsRead } from "./controllers/markAllPatientNotificationsAsRead.js";
import { deletePatientNotificationController } from "./controllers/deletePatientNotificationController.js";

import {
  getPushPublicKey,
  subscribePush,
  unsubscribePush,
} from "./controllers/push.controller.js";

import authMidleWeare from "../../common/middlewares/authMiddleware.js";
const router = Router();

// ── Web-push подписки ──────────────────────────────────────────────
router.get("/push/public-key", getPushPublicKey);
router.post("/push/subscribe", authMidleWeare, subscribePush);
router.post("/push/unsubscribe", authMidleWeare, unsubscribePush);

// GET /notifications - все уведомления пользователя
router.get("/get", authMidleWeare, getNotificationsController);

// POST /notifications - создать уведомление вручную
router.post("/", authMidleWeare, createNotificationController);

// PUT /notifications/:id/read - отметить прочитанным
router.patch("/mark-read", authMidleWeare, markAsReadController);

// DELETE /notifications/:id - удалить уведомление
router.delete("/delete/:id", authMidleWeare, deleteNotificationController);

// ROUTES FOR PATIENTS
router.get(
  "/get-notifications-for-patient",
  authMidleWeare,
  getPatientNotificationsController
);
router.patch(
  "/read/:id",
  authMidleWeare,
  markSinglePatientNotificationAsReadController
);
router.patch(
  "/patient/read-all",
  authMidleWeare,
  markAllPatientNotificationsAsRead
);
router.delete(
  "/patient/delete/:id",
  authMidleWeare,
  deletePatientNotificationController
);

export default router;
