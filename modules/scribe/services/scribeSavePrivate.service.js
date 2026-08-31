// server/modules/scribe/services/scribeSavePrivate.service.js
// ─────────────────────────────────────────────────────────────────────
//   Черновик приёма → карта пациента ЧАСТНОГО ВРАЧА.
//
//   Отдельный путь от клинического, и не по прихоти: у клиники запись
//   принадлежит организации и живёт за проверкой прав арендатора, у
//   частного врача — принадлежит ему одному, и никакой клиники в ней
//   нет вовсе. Пропустить частную запись через клинический путь значило
//   бы приписать ей арендатора, которого не существует.
//
//   ─── ЧЬИ ПАЦИЕНТЫ ─────────────────────────────────────────────────
//
//   Владение проверяется по-разному, потому что модели разные:
//
//     NewPatientPolyclinic — doctorId это СПИСОК врачей: пациента ведут
//       несколько, и запись вправе сделать любой из них;
//     DoctorPrivatePatient — createdBy, один владелец.
//
//   Проверка обязательна и здесь важнее, чем в клинике: там доступ
//   ограничен арендатором, а тут — только этим сравнением. Без него
//   врач мог бы дописать запись в чужую карту, зная её идентификатор.
// ─────────────────────────────────────────────────────────────────────

import ScribeSession from "../models/scribeSession.model.js";
import newPatientMedicalHistory from "../../../common/models/Polyclinic/MedicalHistory/newPatientMedicalHistory.js";
import NewPatientPolyclinic from "../../../common/models/Polyclinic/newPatientPolyclinic.js";
import DoctorPrivatePatient from "../../../common/models/Polyclinic/DoctorPrivatePatient.js";
import {
  NotFoundError,
  ForbiddenError,
  ValidationError,
} from "../../../common/utils/errors.js";
import logger from "../../../common/logger.js";

const log = logger.child({ module: "scribe/save-private" });

const MODELS = {
  NewPatientPolyclinic,
  DoctorPrivatePatient,
};

/**
 * Карта частного врача по аккаунту пациента.
 *
 * Ищем среди СВОИХ пациентов, а не по всей базе: одноимённая карта у
 * другого врача — чужая запись.
 */
export async function findPrivatePatientByUser({ doctorId, userId }) {
  const poly = await NewPatientPolyclinic.findOne({
    linkedUserId: userId,
    doctorId: doctorId,
    isDeleted: { $ne: true },
  })
    .select("firstNameEncrypted lastNameEncrypted")
    .lean();

  if (poly) {
    return {
      id: String(poly._id),
      patientTypeModel: "NewPatientPolyclinic",
    };
  }

  const priv = await DoctorPrivatePatient.findOne({
    linkedUserId: userId,
    createdBy: doctorId,
  })
    .select("firstName lastName")
    .lean();

  if (priv) {
    return {
      id: String(priv._id),
      patientTypeModel: "DoctorPrivatePatient",
      firstName: priv.firstName || "",
      lastName: priv.lastName || "",
    };
  }

  return null;
}

/** Принадлежит ли карта этому врачу. */
async function assertOwnership({ doctorId, patientRef, patientTypeModel }) {
  const Model = MODELS[patientTypeModel];
  if (!Model) throw new ValidationError("Неизвестный тип карты пациента", { i18n: "app.scribe.unknownPatientCardType" });

  const doc = await Model.findById(patientRef).select("doctorId createdBy").lean();
  if (!doc) throw new NotFoundError("Карта пациента не найдена", { i18n: "app.scribe.patientCardNotFound" });

  const owns =
    patientTypeModel === "NewPatientPolyclinic"
      ? (doc.doctorId || []).some((d) => String(d) === String(doctorId))
      : String(doc.createdBy) === String(doctorId);

  if (!owns) {
    throw new ForbiddenError("Это не ваш пациент", { i18n: "app.scribe.notYourPatient" });
  }
}

/**
 * Сохранить правленый врачом черновик в карту частной практики.
 */
export async function saveScribeDraftPrivate({
  sessionId,
  doctorId,
  patientRef,
  patientTypeModel,
  body,
}) {
  const session = await ScribeSession.findById(sessionId);
  if (!session) throw new NotFoundError("Сеанс записи не найден", { i18n: "app.scribe.sessionNotFound" });
  if (String(session.doctorId) !== String(doctorId)) {
    throw new ForbiddenError("Сохранить может только врач, ведший приём", { i18n: "app.scribe.onlyDoctorCanSave" });
  }
  if (session.dictationJobId) {
    throw new ValidationError("Черновик этого приёма уже сохранён в карту", { i18n: "app.scribe.draftAlreadySaved" });
  }
  if (!patientRef) throw new ValidationError("Не выбрана карта пациента", { i18n: "app.scribe.patientCardNotSelected" });

  await assertOwnership({ doctorId, patientRef, patientTypeModel });

  // Сохраняем ТО, ЧТО ПРИСЛАЛ ВРАЧ, а не собранное моделью: он мог всё
  // переписать, и именно его текст обязан попасть в карту.
  const payload = {
    patientType: patientTypeModel === "DoctorPrivatePatient" ? "private" : "registered",
    patientTypeModel,
    patientRef,
    createdBy: doctorId,
    doctorId,
    // Клиники здесь нет и быть не должно: это запись частной практики.
    createdByClinicId: null,
    createdByEmployee: null,
    status: "draft",
  };

  for (const field of [
    "complaints",
    "anamnesisMorbi",
    "anamnesisVitae",
    "statusPreasens",
    "recommendations",
  ]) {
    const value = body?.[field];
    if (value != null && String(value).trim()) payload[field] = String(value).trim();
  }

  if (body?.diagnosisText && String(body.diagnosisText).trim()) {
    payload.mainDiagnosis = {
      code: "",
      codeTitle: "",
      text: String(body.diagnosisText).trim(),
    };
  }

  const doc = new newPatientMedicalHistory(payload);
  // Контекста аренды здесь нет и не нужно: запись без клиники.
  await doc.save({ skipTenantScope: true });

  session.dictationJobId = doc._id;
  await session.save();

  log.info(
    { sessionId: String(session._id), encounterId: String(doc._id) },
    "Черновик приёма сохранён в карту частной практики",
  );

  return doc;
}

export default { saveScribeDraftPrivate, findPrivatePatientByUser };
