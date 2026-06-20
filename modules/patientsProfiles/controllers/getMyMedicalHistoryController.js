import mongoose from "mongoose";
import newPatientMedicalHistoryModel from "../../../common/models/Polyclinic/MedicalHistory/newPatientMedicalHistory.js";
import NewPatientPolyclinic from "../../../common/models/Polyclinic/newPatientPolyclinic.js";
import ClinicPatient from "../../clinic/clinic-patients/models/clinicPatient.model.js";

/**
 * GET /patient-profile/get-my-medical-history
 *
 * Returns the logged-in patient's own medical history (encounters), pulled
 * from BOTH patient-card systems:
 *   - NewPatientPolyclinic   (legacy policlinic module)
 *   - ClinicPatient          (new clinic multi-tenant module, Sprint 0+)
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  BUG FIX (3 Jun 2026)
 * ─────────────────────────────────────────────────────────────────────────
 *  Previously this only looked at NewPatientPolyclinic + patientTypeModel
 *  "NewPatientPolyclinic". Encounters created by clinics use ClinicPatient
 *  cards + patientTypeModel "ClinicPatient", so they were invisible to the
 *  patient. We now resolve the patient's User._id to cards in BOTH systems
 *  (via linkedUserId) and fetch encounters for either type.
 *
 *  TENANT SCOPE: ClinicPatient and clinic encounters are tenant-scoped
 *  (filtered by clinicId on every query). The patient is NOT inside a
 *  clinic tenant context, so we bypass scoping with
 *  .setOptions({ skipTenantScope: true }) — same pattern as
 *  myClinics.service.js. These are the patient's OWN records across all
 *  clinics, so reading them unscoped is correct and safe.
 *
 *  STATUS FILTER: patients see only finalized encounters (signed / amended),
 *  never a clinic's unsigned draft.
 */
const getMyMedicalHistoryController = async (req, res) => {
  try {
    const userId = req.user?.userId;
    const role = req.user?.role;

    if (!userId || role !== "patient") {
      return res.status(401).json({
        success: false,
        message: "Доступ разрешён только зарегистрированным пациентам",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: "Некорректный userId",
      });
    }

    const objectUserId = new mongoose.Types.ObjectId(userId);

    // ─── 1. Resolve patient cards in BOTH systems via linkedUserId ───

    // Legacy polyclinic cards (not tenant-scoped)
    const polyCards = await NewPatientPolyclinic.find({
      linkedUserId: objectUserId,
      isDeleted: false,
    })
      .select("_id")
      .lean();

    // Clinic cards (tenant-scoped → bypass for patient-side read)
    const clinicCards = await ClinicPatient.find({
      linkedUserId: objectUserId,
      isDeleted: { $ne: true },
    })
      .setOptions({ skipTenantScope: true })
      .select("_id")
      .lean();

    const polyIds = polyCards.map((c) => c._id);
    const clinicIds = clinicCards.map((c) => c._id);

    if (polyIds.length === 0 && clinicIds.length === 0) {
      // No card in either system → no history, but not an error.
      return res.status(200).json({ success: true, count: 0, data: [] });
    }

    // ─── 2. Fetch encounters for either card type ───
    // Patient sees only finalized records (signed/amended), never drafts.

    const orConditions = [];
    if (polyIds.length > 0) {
      orConditions.push({
        patientRef: { $in: polyIds },
        patientTypeModel: "NewPatientPolyclinic",
      });
    }
    if (clinicIds.length > 0) {
      orConditions.push({
        patientRef: { $in: clinicIds },
        patientTypeModel: "ClinicPatient",
      });
    }

    const histories = await newPatientMedicalHistoryModel
      .find({
        $or: orConditions,
        status: { $in: ["signed", "amended"] },
      })
      .setOptions({ skipTenantScope: true })
      .populate("createdBy")
      .populate({
        path: "doctorId",
        populate: { path: "specialization" },
      })
      .populate("doctorProfileId")
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: histories.length,
      data: histories,
    });
  } catch (error) {
    console.error("❌ getMyMedicalHistoryController error:", error);
    return res.status(500).json({
      success: false,
      message: "Ошибка сервера при получении историй болезни",
    });
  }
};

export default getMyMedicalHistoryController;
