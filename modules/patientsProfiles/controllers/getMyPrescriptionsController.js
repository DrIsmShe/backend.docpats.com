// server/modules/patientsProfiles/controllers/getMyPrescriptionsController.js
//
// Список рецептов пациента — со всех клиник, где у него есть привязанная
// карта (ClinicPatient.linkedUserId === userId). Read-only.
//
// Мост: userId → ClinicPatient[] (skipTenantScope) → Prescription[]
//   (patientRef ∈ карты пациента). PHI в Prescription хранится plaintext.
//
// Форма ответа: { ok: true, items: [...] } — каждый элемент уже «плоский»
// для списка (без чужих служебных полей).

import Prescription from "../../../common/models/Polyclinic/Prescription.js";
import ClinicPatient from "../../clinic/clinic-patients/models/clinicPatient.model.js";
import DoctorPrivatePatient from "../../../common/models/Polyclinic/DoctorPrivatePatient.js";
import NewPatientPolyclinic from "../../../common/models/Polyclinic/newPatientPolyclinic.js";
import Clinic from "../../clinic/clinic-core/models/clinic.model.js";
import { decryptPHI } from "../../../common/utils/phiCrypto.js";
import { tReq } from "../../../common/i18n/index.js";

const getMyPrescriptionsController = async (req, res) => {
  try {
    const userId = req.user?.userId || req.session?.userId;
    if (!userId) {
      return res.status(401).json({ ok: false, error: tReq(req, "app.auth.notAuthorized2") });
    }

    // 1. Все карты пациента, привязанные к этому юзеру.
    //
    // Карт три вида, и рецепт может быть выписан на любую: клиника ведёт
    // ClinicPatient, врач на частном приёме — DoctorPrivatePatient, врач в
    // поликлинике — NewPatientPolyclinic. Раньше мост искал только по
    // клиническим картам, и рецепт, выписанный врачом лично, у пациента в
    // списке не появлялся вовсе — при том что сам рецепт создан верно.
    const [clinicCards, privateCards, polyCards] = await Promise.all([
      ClinicPatient.find({ linkedUserId: userId })
        .setOptions({ skipTenantScope: true })
        .select("_id")
        .lean(),
      DoctorPrivatePatient.find({ linkedUserId: userId }).select("_id").lean(),
      NewPatientPolyclinic.find({ linkedUserId: userId }).select("_id").lean(),
    ]);

    const byModel = [
      ["ClinicPatient", clinicCards],
      ["DoctorPrivatePatient", privateCards],
      ["NewPatientPolyclinic", polyCards],
    ].filter(([, rows]) => rows.length);

    if (!byModel.length) {
      return res.status(200).json({ ok: true, items: [] });
    }

    // 2. Все рецепты по этим картам. Модель указываем вместе с
    //    идентификаторами: одного patientRef мало — он полиморфный.
    const docs = await Prescription.find({
      $or: byModel.map(([model, rows]) => ({
        patientTypeModel: model,
        patientRef: { $in: rows.map((r) => r._id) },
      })),
    })
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();

    if (!docs.length) {
      return res.status(200).json({ ok: true, items: [] });
    }

    // 3. Названия клиник-авторов (для подписи «кто выписал»).
    const clinicIds = [
      ...new Set(
        docs
          .map((d) =>
            d.createdByClinicId ? String(d.createdByClinicId) : null,
          )
          .filter(Boolean),
      ),
    ];
    const clinics = clinicIds.length
      ? await Clinic.find({ _id: { $in: clinicIds } })
          .select("_id name")
          .lean()
      : [];
    const clinicNameById = new Map(clinics.map((c) => [String(c._id), c.name]));

    // Имена врачей — для рецептов, выписанных вне клиники. Без них такой
    // рецепт стоит в списке вообще без источника: ни клиники, ни автора.
    // Одним запросом на все строки, а не по запросу на строку.
    const doctorIds = [
      ...new Set(
        docs
          .filter((d) => !d.createdByClinicId)
          .map((d) => (d.createdBy ? String(d.createdBy) : null))
          .filter(Boolean),
      ),
    ];
    const doctorNameById = new Map();
    if (doctorIds.length) {
      try {
        const { default: User } = await import(
          "../../../common/models/Auth/users.js"
        );
        // Без .lean(): расшифровка имени живёт в методе документа.
        const users = await User.find({ _id: { $in: doctorIds } }).select(
          "firstNameEncrypted lastNameEncrypted",
        );
        for (const u of users) {
          const f = typeof u.decryptFields === "function" ? u.decryptFields() : {};
          const name = [f.firstName, f.lastName].filter(Boolean).join(" ");
          if (name) doctorNameById.set(String(u._id), name);
        }
      } catch (e) {
        // Имени не будет — список важнее подписи.
        console.error("[мои рецепты] врач не определён:", e.message);
      }
    }

    // 4. Сборка плоского списка.
    const items = docs.map((d) => ({
      _id: String(d._id),
      status: d.status,
      issuedAt: d.issuedAt || d.createdAt || null,
      createdAt: d.createdAt || null,
      closedAt: d.closedAt || null,
      closedReason: d.closedReason || null,
      clinicId: d.createdByClinicId ? String(d.createdByClinicId) : null,
      clinicName: d.createdByClinicId
        ? clinicNameById.get(String(d.createdByClinicId)) || ""
        : "",
      // Кто выписал, когда клиники нет. Клиент показывает это там же, где
      // название клиники: у рецепта всегда должен быть виден источник.
      issuedByName: d.createdByClinicId
        ? ""
        : doctorNameById.get(String(d.createdBy || "")) || "",
      // Текст диагноза, общие указания и указания к приёму хранятся
      // зашифрованными. Документ читается напрямую, поэтому расшифровка
      // нужна здесь: без неё пациент видел в списке своих рецептов
      // строку "fce1df8c…:7b371477…" вместо диагноза.
      diagnosis: d.diagnosis
        ? {
            code: d.diagnosis.code || "",
            text: decryptPHI(d.diagnosis.text) || "",
          }
        : null,
      generalNotes: decryptPHI(d.generalNotes) || "",
      items: Array.isArray(d.items)
        ? d.items.map((it) => ({
            inn: it.inn || "",
            brandName: it.brandName || "",
            strength: it.strength || "",
            form: it.form || "other",
            route: it.route || "oral",
            dose: it.dose || "",
            frequency: it.frequency || "",
            duration: it.duration || "",
            quantity: it.quantity || "",
            prn: !!it.prn,
            instructions: decryptPHI(it.instructions) || "",
          }))
        : [],
    }));

    return res.status(200).json({ ok: true, items });
  } catch (error) {
    console.error("❌ getMyPrescriptions error:", error);
    return res.status(500).json({ ok: false, error: "Ошибка сервера" });
  }
};

export default getMyPrescriptionsController;
