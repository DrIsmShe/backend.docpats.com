// server/modules/clinic/clinic-medical/routes/patientSummary.routes.js
//
//   GET /clinic/medical/patients/:patientId/summary
//
// Один экран вместо двенадцати вкладок. Цепочка проверок та же, что у
// остальных разделов карты, и это обязательно: сводка показывает больше
// сведений сразу, значит требования к доступу у неё не ниже, а выше.
//
// Согласие проверяется по scope "encounters" — как у анализов и приёмов.
// Внутри сервис ещё раз спрашивает каждый источник по его собственным
// правилам, так что раздел, к которому доступа нет, просто окажется
// пустым, а не откроется заодно с остальными.

import express from "express";
import auditMiddleware from "../../../audit/middleware/auditMiddleware.js";
import { ACTIONS } from "../rbac/clinicMedicalRBAC.js";
import { checkClinicMedicalAccess } from "../middleware/checkClinicMedicalAccess.middleware.js";
import { resolveClinicPatient } from "../middleware/resolveClinicPatient.middleware.js";
import { checkConsent } from "../middleware/checkConsent.middleware.js";
import * as ctrl from "../controllers/patientSummary.controller.js";
import * as fhirCtrl from "../controllers/fhirExport.controller.js";

const router = express.Router();
const ENC = ACTIONS.ENCOUNTER;

router.get(
  "/patients/:patientId/summary",
  // Сводка — это чтение всей карты одним движением, и в журнале она
  // должна выглядеть именно так, а не как восемь отдельных списков.
  auditMiddleware({
    resourceType: "clinic-medical-summary",
    action: ENC.LIST,
    resourceIdFrom: () => null,
    resourceOwnerIdFrom: (req) => req.clinicPatient?.linkedUserId || null,
    metaFrom: (req) => ({ patientId: req.params?.patientId }),
  }),
  checkClinicMedicalAccess({ action: ENC.LIST }),
  resolveClinicPatient,
  checkConsent({ scope: "encounters", patientLevel: true }),
  ctrl.getPatientSummaryController,
);

// ─── Выгрузка карты в FHIR R4 ─────────────────────────────────────────
//
// Стоит рядом со сводкой не случайно: оба маршрута собирают карту
// целиком из одних и тех же источников. Разница в том, что сводка
// показывает выжимку на экране, а выгрузка кладёт ВСЮ карту вместе с
// именем в файл, который дальше живёт своей жизнью.
//
// Поэтому здесь действие WRITE, а не READ, и свой тип ресурса в
// журнале: через полгода надо уметь ответить, кто и когда унёс карту.
router.get(
  "/patients/:patientId/fhir",
  auditMiddleware({
    resourceType: "clinic-medical-fhir-export",
    action: ENC.CREATE,
    resourceIdFrom: () => null,
    resourceOwnerIdFrom: (req) => req.clinicPatient?.linkedUserId || null,
    metaFrom: (req) => ({ patientId: req.params?.patientId }),
  }),
  checkClinicMedicalAccess({ action: ENC.CREATE }),
  resolveClinicPatient,
  checkConsent({ scope: "encounters", patientLevel: true }),
  fhirCtrl.exportPatientFhirController,
);

// Сохранение черновика, собранного из разговора на приёме.
//
// Действие CREATE и по правам, и по журналу: это создание записи в
// карте, а то, что текст пришёл из расшифровки, а не с клавиатуры, дела
// не меняет — отвечает за запись врач.
router.post(
  "/patients/:patientId/from-scribe/:sessionId",
  auditMiddleware({
    resourceType: "clinic-medical-encounter",
    action: ENC.CREATE,
    resourceIdFrom: () => null,
    resourceOwnerIdFrom: (req) => req.clinicPatient?.linkedUserId || null,
    metaFrom: (req) => ({
      patientId: req.params?.patientId,
      fromScribe: true,
    }),
  }),
  checkClinicMedicalAccess({ action: ENC.CREATE }),
  resolveClinicPatient,
  checkConsent({ scope: "encounters", patientLevel: true }),
  ctrl.saveFromScribeController,
);

// Карта пациента по пользователю платформы. Без аудита содержимого:
// отдаётся только идентификатор и имя, которые врач и так видит в
// звонке; сам доступ к карте проверяется при чтении и записи.
router.get(
  "/patients/by-user/:userId",
  checkClinicMedicalAccess({ action: ENC.LIST }),
  ctrl.findPatientByUserController,
);

export default router;
