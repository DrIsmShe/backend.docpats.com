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
import Clinic from "../../clinic/clinic-core/models/clinic.model.js";

const getMyPrescriptionsController = async (req, res) => {
  try {
    const userId = req.user?.userId || req.session?.userId;
    if (!userId) {
      return res.status(401).json({ ok: false, error: "Не авторизован" });
    }

    // 1. Все карты пациента (во всех клиниках), привязанные к этому юзеру.
    const cards = await ClinicPatient.find({ linkedUserId: userId })
      .setOptions({ skipTenantScope: true })
      .select("_id")
      .lean();

    if (!cards.length) {
      return res.status(200).json({ ok: true, items: [] });
    }

    const cardIds = cards.map((c) => c._id);

    // 2. Все рецепты по этим картам.
    const docs = await Prescription.find({
      patientRef: { $in: cardIds },
      patientTypeModel: "ClinicPatient",
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
      diagnosis: d.diagnosis
        ? {
            code: d.diagnosis.code || "",
            text: d.diagnosis.text || "",
          }
        : null,
      generalNotes: d.generalNotes || "",
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
            instructions: it.instructions || "",
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
