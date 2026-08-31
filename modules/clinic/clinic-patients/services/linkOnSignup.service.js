// server/modules/clinic/clinic-patients/services/linkOnSignup.service.js
//
// Связать карты пациента в клиниках с только что подтверждённым аккаунтом.
//
// ЗАЧЕМ. Связь карты с аккаунтом умела возникать только в одну сторону:
// регистратор заводит карту, система находит УЖЕ существующего пользователя
// DocPats и связывает. Обратного пути не было вовсе — в модуле auth не было
// ни одного упоминания карт.
//
// От этого ломался главный расчёт проекта: видеоприём положен только
// зарегистрированным, и это причина завести аккаунт. Но человек, который
// получал ссылку на приём, видел отказ, шёл регистрироваться — и получал
// отказ снова, потому что новый аккаунт с картой клиники ничем не связан.
// Он делал ровно то, чего от него хотели, и не получал ничего.
//
// ПОЧЕМУ ТОЛЬКО ПОЧТА. Код подтверждения уходит на почту, и isVerified
// ставится лишь после его ввода — почта доказана. Телефон не подтверждается
// никогда, поэтому связывание по номеру отдало бы чужую медкарту любому,
// кто наберёт чужой номер при регистрации. Здесь номера нет намеренно.
//
// ПОЧЕМУ ХЭШ СЧИТАЕТСЯ ЗАНОВО. Пользователь и карта хранят хэш почты
// РАЗНЫМИ способами: у пользователя это простой sha256, у карты — hmac с
// секретным ключом. Сравнивать User.emailHash с ClinicPatient.emailHash
// бессмысленно, совпадений не будет никогда. Поэтому хэш считается из
// открытой почты функцией самой карты.
//
// ЧТО ЭТО НЕ ДАЁТ. Связывание открывает пациенту доступ к его собственной
// карте — не клинике доступ к пациенту. Карту клиника и так ведёт, она её
// и завела. Право клиники читать записи пациента по-прежнему требует
// отдельного согласия (PatientConsent), здесь оно не выдаётся.

import ClinicPatient, {
  hashValue,
} from "../models/clinicPatient.model.js";
import { notify } from "../../../notifications/services/notification.service.js";

/**
 * @param {object} p
 * @param {string} p.email   открытая почта, только что подтверждённая кодом
 * @param {string|ObjectId} p.userId  владелец аккаунта
 * @returns {Promise<{linked: number, clinics: string[]}>}
 */
export async function linkClinicCardsByEmail({ email, userId }) {
  if (!email || !userId) return { linked: 0, clinics: [] };

  const emailHash = hashValue(email);
  if (!emailHash) return { linked: 0, clinics: [] };

  // skipTenantScope: искать нужно по ВСЕМ клиникам. При регистрации
  // текущей клиники нет вовсе, а плагин тенантности по умолчанию сузил бы
  // выборку до неё — то есть до пустоты.
  const cards = await ClinicPatient.find({ emailHash, linkedUserId: null })
    .select("_id clinicId")
    .setOptions({ skipTenantScope: true })
    .lean();

  if (!cards.length) return { linked: 0, clinics: [] };

  const clinics = [];
  for (const card of cards) {
    // Условие linkedUserId: null повторено в самом обновлении, а не только
    // в выборке: между поиском и записью карту мог связать регистратор.
    // Перехватывать чужую связь нельзя.
    const res = await ClinicPatient.updateOne(
      { _id: card._id, linkedUserId: null },
      { $set: { linkedUserId: userId } },
    ).setOptions({ skipTenantScope: true });

    if (!res.modifiedCount) continue;
    clinics.push(String(card.clinicId));

    const clinicName = await resolveClinicName(card.clinicId);
    // Уведомление — не формальность: человек должен узнать, что карта
    // появилась в кабинете, иначе он её просто не найдёт.
    await notify({
      userId,
      type: "system_message",
      title: "Ваша медкарта найдена",
      message: clinicName
        ? `Клиника «${clinicName}» ведёт вашу медицинскую карту — теперь она в вашем кабинете.`
        : "Клиника ведёт вашу медицинскую карту — теперь она в вашем кабинете.",
      i18n: {
        title: "app.notify.cardLinked.title",
        message: clinicName
          ? "app.notify.cardLinked.messageWithClinic"
          : "app.notify.cardLinked.message",
        params: { clinicName: clinicName || "" },
      },
      link: "/patient/my-clinics",
      icon: "clipboard-heart",
      meta: { clinicId: String(card.clinicId), patientId: String(card._id) },
    }).catch(() => {});
  }

  return { linked: clinics.length, clinics };
}

async function resolveClinicName(clinicId) {
  try {
    const Clinic = (await import("../../clinic-core/models/clinic.model.js"))
      .default;
    const clinic = await Clinic.findById(clinicId).select("name").lean();
    return clinic?.name || null;
  } catch {
    return null;
  }
}

export default { linkClinicCardsByEmail };
