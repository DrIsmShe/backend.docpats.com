// server/modules/patientsProfiles/utils/phiAccess.js
//
// Единая проверка доступа к PHI-записи пациента (снимки, истории болезни и т.п.).
// Раньше часть "get-my-*"-контроллеров читала запись по :id БЕЗ проверки
// владельца — любой (иногда даже без логина) мог прочитать чужие медданные.
//
// Доступ разрешён, если запрашивающий:
//   - админ;
//   - врач, создавший запись (doc.doctor / doc.doctorId / doc.createdBy);
//   - пациент-владелец карты, к которой привязана запись
//     (через linkedUserId карты ИЛИ через patientPolyclinicId из сессии).
//
// Поддерживает разные имена поля-пациента: doc.patient / doc.patientId /
// doc.patientRef (в проекте встречаются все три).

export function getReqUserId(req) {
  return req.userId || req.user?.userId || req.session?.userId || null;
}

export function canAccessPatientRecord(req, doc) {
  const userId = getReqUserId(req);
  if (!userId || !doc) return false;
  const uid = String(userId);
  const role = req.user?.role || req.session?.role || null;

  // Админ — полный доступ (модерация/поддержка).
  if (role === "admin" || role === "superadmin") return true;

  // Врач-создатель записи.
  const docDoctor =
    doc.doctor?._id ||
    doc.doctor ||
    doc.doctorId?._id ||
    doc.doctorId ||
    doc.createdBy?._id ||
    doc.createdBy;
  if (docDoctor && String(docDoctor) === uid) return true;

  // Карта пациента, к которой привязана запись.
  const card = doc.patientId || doc.patientRef || doc.patient;

  // Пациент-владелец через linkedUserId карты (если карта populated).
  const linkedUser = card?.linkedUserId?._id || card?.linkedUserId;
  if (linkedUser && String(linkedUser) === uid) return true;

  // Пациент-владелец через patientPolyclinicId из authMiddleware === id карты.
  const cardId = card?._id || card;
  const myCard = req.user?.patientPolyclinicId;
  if (cardId && myCard && String(cardId) === String(myCard)) return true;

  return false;
}
