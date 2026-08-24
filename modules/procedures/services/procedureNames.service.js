// server/modules/procedures/services/procedureNames.service.js
//
// Имена пациентов для списка вмешательств.
//
// Одним пакетным запросом на коллекцию, а не по документу в цикле: список
// дня и месяца читается на каждом открытии календаря, и N+1 здесь стоил бы
// сотни расшифровок на ровном месте.
//
// Приватные карточки читаются ЧЕРЕЗ МОДЕЛЬ (не .lean()): fullName — это
// виртуал поверх зашифрованных полей, и на голом объекте его нет.

import DoctorPrivatePatient from "../../../common/models/Polyclinic/DoctorPrivatePatient.js";
import NewPatientPolyclinic from "../../../common/models/Polyclinic/newPatientPolyclinic.js";
import User, { decrypt } from "../../../common/models/Auth/users.js";

function joinName(first, last) {
  return [decrypt(first), decrypt(last)].filter(Boolean).join(" ") || null;
}

/**
 * @param {Array} bookings - документы ProcedureBooking (lean или нет)
 * @returns {Promise<Map<string,string>>} id пациента → имя
 */
export async function resolvePatientNames(bookings = []) {
  const registeredIds = [];
  const privateIds = [];

  for (const b of bookings) {
    if (b.patientId) registeredIds.push(b.patientId);
    else if (b.privatePatientId) privateIds.push(b.privatePatientId);
  }

  const names = new Map();

  // patientId исторически указывает то на User, то на карту поликлиники —
  // спрашиваем обе коллекции и берём то, что нашлось.
  const [users, cards, privates] = await Promise.all([
    registeredIds.length
      ? User.find({ _id: { $in: registeredIds } })
          .select("firstNameEncrypted lastNameEncrypted")
          .lean()
      : [],
    registeredIds.length
      ? NewPatientPolyclinic.find({ _id: { $in: registeredIds } })
          .select("firstNameEncrypted lastNameEncrypted")
          .lean()
      : [],
    privateIds.length
      ? DoctorPrivatePatient.find({ _id: { $in: privateIds } })
      : [],
  ]);

  for (const u of users) {
    names.set(String(u._id), joinName(u.firstNameEncrypted, u.lastNameEncrypted));
  }
  for (const c of cards) {
    // Карта поликлиники не перетирает найденного пользователя: если id
    // разрешился в аккаунт, имя из аккаунта каноничнее.
    const key = String(c._id);
    if (!names.get(key)) {
      names.set(key, joinName(c.firstNameEncrypted, c.lastNameEncrypted));
    }
  }
  for (const p of privates) {
    names.set(String(p._id), p.fullName || null);
  }

  return names;
}

/** Имя пациента конкретной записи — по уже собранной карте. */
export function nameOf(booking, names) {
  const key = String(booking.patientId || booking.privatePatientId || "");
  return names.get(key) || null;
}

export default resolvePatientNames;
