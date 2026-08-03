// modules/clinic/clinic-medical/routes/examinationTemplate.routes.js
//
// Справочник заготовок для протоколов исследований.
//
// Итоговые адреса (монтируется в /medical):
//   GET    /medical/examination-templates?modality=CT&kind=report
//   POST   /medical/examination-templates
//   GET    /medical/examination-templates/:templateId
//   PATCH  /medical/examination-templates/:templateId
//   DELETE /medical/examination-templates/:templateId
//
// Пациента в адресах нет намеренно: заготовка принадлежит клинике, а не
// пациенту, поэтому ни resolveClinicPatient, ни проверка согласий здесь не
// нужны. Изоляцию между клиниками обеспечивает плагин tenantScoped на модели.
//
// Тело запросов — обычный JSON, без multipart. Значит и обходной приём с
// восстановлением контекста после multer (см. imaging.routes.js) здесь не
// требуется: express.json() цепочку AsyncLocalStorage не рвёт.

import express from "express";
import * as ctrl from "../controllers/examinationTemplate.controller.js";

const router = express.Router();

router
  .route("/examination-templates")
  .get(ctrl.list)
  .post(ctrl.create);

router
  .route("/examination-templates/:templateId")
  .get(ctrl.getOne)
  .patch(ctrl.update)
  .delete(ctrl.remove);

export default router;
