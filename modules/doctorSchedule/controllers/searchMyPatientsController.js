// server/modules/doctorSchedule/controllers/searchMyPatientsController.js
//
// Пациенты врача одним списком — для формы записи из календаря.
//
// GET /schedule/appointment/my-patients?q=иван
//
// Три источника, потому что пациент врача может существовать в трёх видах:
//   • User            — аккаунт на платформе (в myDoctors стоит этот врач)
//   • NewPatientPolyclinic — карта пациента в кабинете врача
//   • DoctorPrivatePatient — приватная карточка (в том числе заведённая
//                            прямо из формы записи «человек с улицы»)
//
// Поиск идёт ПО РАСШИФРОВАННЫМ именам в памяти, а не запросом к БД: ФИО
// хранятся шифрованными, и regexp по шифротексту ничего не найдёт. Список
// пациентов одного врача измеряется сотнями, поэтому это дешевле, чем
// заводить ещё один blind-index под подстроку (его и не бывает — хэш ищет
// только точное совпадение).

import ProfileDoctor from "../../../common/models/DoctorProfile/profileDoctor.js";
import NewPatientPolyclinic from "../../../common/models/Polyclinic/newPatientPolyclinic.js";
import DoctorPrivatePatient from "../../../common/models/Polyclinic/DoctorPrivatePatient.js";
import User, { decrypt } from "../../../common/models/Auth/users.js";
import { tReq } from "../../../common/i18n/index.js";
import { errorText } from "../../../common/i18n/index.js";

const HARD_LIMIT = 400; // потолок на источник — защита от выгрузки всей базы
const RESULT_LIMIT = 30;

function nameOf(doc) {
  return [decrypt(doc.firstNameEncrypted), decrypt(doc.lastNameEncrypted)]
    .filter(Boolean)
    .join(" ")
    .trim();
}

export const searchMyPatientsController = async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res
        .status(401)
        .json({ success: false, message: tReq(req, "app.auth.required") });
    }

    const q = String(req.query.q || "")
      .trim()
      .toLowerCase();

    const profile = await ProfileDoctor.findOne({ userId }).lean();
    if (!profile) {
      return res
        .status(404)
        .json({ success: false, message: tReq(req, "app.doctor.profileNotFound") });
    }

    const [accounts, cards, privates] = await Promise.all([
      User.find({
        myDoctors: { $in: [userId] },
        role: "patient",
        isDeleted: { $ne: true },
      })
        .select("firstNameEncrypted lastNameEncrypted")
        .limit(HARD_LIMIT)
        .lean(),

      NewPatientPolyclinic.find({
        doctorId: { $in: [userId] },
        isDeleted: { $ne: true },
        isArchived: { $ne: true },
      })
        .select("firstNameEncrypted lastNameEncrypted linkedUserId")
        .limit(HARD_LIMIT)
        .lean(),

      DoctorPrivatePatient.find({
        doctorProfileId: profile._id,
        isDeleted: { $ne: true },
        isArchived: { $ne: true },
      })
        .select("firstNameEncrypted lastNameEncrypted phoneEncrypted linkedUserId")
        .limit(HARD_LIMIT)
        .lean(),
    ]);

    const items = [];
    const seen = new Set();

    const push = (item) => {
      if (!item.name || seen.has(item.id)) return;
      seen.add(item.id);
      items.push(item);
    };

    for (const u of accounts) {
      push({
        id: String(u._id),
        kind: "registered",
        hasAccount: true,
        name: nameOf(u),
      });
    }

    for (const c of cards) {
      // Карта, привязанная к аккаунту, уже пришла как аккаунт — не дублируем.
      if (c.linkedUserId && seen.has(String(c.linkedUserId))) continue;
      push({
        id: String(c.linkedUserId || c._id),
        kind: "registered",
        hasAccount: Boolean(c.linkedUserId),
        name: nameOf(c),
      });
    }

    for (const p of privates) {
      push({
        id: String(p._id),
        kind: "private",
        hasAccount: Boolean(p.linkedUserId),
        name: nameOf(p),
        phone: decrypt(p.phoneEncrypted) || null,
      });
    }

    const filtered = q
      ? items.filter(
          (i) =>
            i.name.toLowerCase().includes(q) ||
            String(i.phone || "").includes(q),
        )
      : items;

    filtered.sort((a, b) => a.name.localeCompare(b.name));

    return res.json({
      success: true,
      total: filtered.length,
      items: filtered.slice(0, RESULT_LIMIT),
    });
  } catch (err) {
    console.error("❌ Ошибка searchMyPatients:", err);
    return res
      .status(500)
      .json({ success: false, message: tReq(req, "app.server.error"), error: errorText(err, req) });
  }
};

export default searchMyPatientsController;
