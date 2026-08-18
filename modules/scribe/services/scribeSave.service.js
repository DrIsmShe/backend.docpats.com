// server/modules/scribe/services/scribeSave.service.js
//
// Черновик приёма → запись в карте клиники.
//
// ЖИВЁТ ВНУТРИ КЛИНИЧЕСКОГО РОУТЕРА, а не в /api/v1/scribe. Причина
// одна и существенная: запись в карту требует контекста аренды и
// проверки прав, а они появляются только за tenantMiddleware. Сделать
// сохранение в scribe-модуле означало бы либо продублировать проверку
// доступа (и однажды разойтись с оригиналом), либо обойти её.
//
// СОХРАНЯЕТ ВРАЧ, А НЕ СИСТЕМА. Черновик не создаётся сам по окончании
// приёма: врач сначала видит его на экране рядом с расшифровкой, правит
// и только потом нажимает «Сохранить». Разница между «врач принял
// черновик» и «система записала за врача» — это разница между
// инструментом и подлогом.

import ScribeSession from "../models/scribeSession.model.js";
import { createEncounter } from "../../clinic/clinic-medical/services/medicalHistory.service.js";
import {
  NotFoundError,
  ForbiddenError,
  ValidationError,
} from "../../../common/utils/errors.js";
import { getCurrentUserId } from "../../../common/context/tenantContext.js";
import logger from "../../../common/logger.js";

const log = logger.child({ module: "scribe/save" });

/**
 * Сохранить правленый врачом черновик как запись карты.
 *
 * @param {object} args
 * @param {string} args.sessionId
 * @param {object} args.patient — документ пациента (из resolveClinicPatient)
 * @param {object} args.body — поля черновика ПОСЛЕ правки врачом
 */
export async function saveScribeDraft({ sessionId, patient, body }) {
  const session = await ScribeSession.findById(sessionId);
  if (!session) throw new NotFoundError("Сеанс записи не найден");

  const userId = getCurrentUserId();
  if (String(session.doctorId) !== String(userId)) {
    throw new ForbiddenError("Сохранить может только врач, ведший приём");
  }

  if (session.dictationJobId) {
    // Повторное сохранение создало бы вторую запись об одном приёме, и
    // различить их в карте потом было бы нечем.
    throw new ValidationError("Черновик этого приёма уже сохранён в карту");
  }

  // Сохраняем ТО, ЧТО ПРИСЛАЛ ВРАЧ, а не то, что собрала модель.
  // Врач мог всё переписать — и именно его текст обязан попасть в карту.
  // Брать здесь session.draft значило бы молча отменить его правки.
  const encounter = await createEncounter({
    patient,
    body: {
      complaints: body?.complaints || "",
      anamnesisMorbi: body?.anamnesisMorbi || "",
      anamnesisVitae: body?.anamnesisVitae || "",
      statusPreasens: body?.statusPreasens || "",
      recommendations: body?.recommendations || "",
      ...(body?.diagnosisText
        ? { mainDiagnosis: { code: "", codeTitle: "", text: body.diagnosisText } }
        : {}),
      // Статус черновика — явно. Подписывает врач отдельным действием
      // обычным путём модуля: подпись под записью, которую человек не
      // перечитал, обесценивает саму подпись.
      status: "draft",
    },
  });

  session.dictationJobId = encounter._id || null;
  await session.save();

  log.info(
    { sessionId: String(session._id), encounterId: String(encounter._id) },
    "Черновик приёма сохранён в карту",
  );

  return encounter;
}

export default { saveScribeDraft };
