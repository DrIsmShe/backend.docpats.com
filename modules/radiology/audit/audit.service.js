// server/modules/radiology/audit/audit.service.js
//
// Тонкая обёртка записи доменного события. Fire-and-forget: аудит не
// должен ронять основную операцию, поэтому ошибку глотаем в лог. Никаких
// PHI/содержимого снимка в metadata — только структурные признаки.

import RadiologyEvent from "./radiologyEvent.model.js";
import logger from "../../../common/logger.js";

export function recordRadiologyEvent({
  action,
  actorId = null,
  actorRole = null,
  caseId = null,
  attemptId = null,
  metadata = {},
}) {
  RadiologyEvent.create({
    action,
    actorId,
    actorRole,
    caseId,
    attemptId,
    metadata,
  }).catch((err) => {
    logger?.warn?.(
      { action, err: String(err?.message ?? err) },
      "radiology audit write failed",
    );
  });
}
