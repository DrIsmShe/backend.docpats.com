import newPatientMedicalHistory from "../../../common/models/Polyclinic/MedicalHistory/newPatientMedicalHistory.js";
import User from "../../../common/models/Auth/users.js";
import DoctorProfile from "../../../common/models/DoctorProfile/profileDoctor.js";
import { decrypt } from "../../../common/models/Auth/users.js";

const patientsMedicalHistoryGetController = async (req, res) => {
  try {
    const { patient, patientType } = req;

    if (!patient || !patientType) {
      return res.status(404).json({
        message: "Пациент не найден",
      });
    }

    /* ─────────────── STABLE patientId ─────────────── */
    const patientId =
      patient.patientId?.toString?.() || patient._id?.toString?.();

    if (!patientId) {
      return res.status(400).json({
        message: "Не удалось определить patientId",
      });
    }

    /* ─────────────── HISTORY (STRICT) ─────────────── */
    const medicalHistory = await newPatientMedicalHistory
      .find({
        patientType,
        patientRef: patient._id,
      })
      .populate({
        path: "createdBy",
        select:
          "firstNameEncrypted lastNameEncrypted emailEncrypted specialization",
        populate: {
          path: "specialization",
          select: "name",
        },
      })
      .sort({ createdAt: -1 });

    const decryptedMedicalHistory = medicalHistory.map((doc) => {
      const h = doc.toObject();
      if (!h.createdBy) return h;

      return {
        ...h,
        createdBy: {
          ...h.createdBy,
          firstName: decrypt(h.createdBy.firstNameEncrypted),
          lastName: decrypt(h.createdBy.lastNameEncrypted),
          email: decrypt(h.createdBy.emailEncrypted),
          specialization: h.createdBy.specialization?.name || "Неизвестно",
        },
      };
    });

    /* ─────────────── DOCTOR (OPTIONAL) ─────────────── */
    let decryptedDoctorInfo = null;
    let doctorProfileInfo = null;

    if (patient.doctorId) {
      const doctor = await User.findById(patient.doctorId)
        .populate("specialization", "name")
        .select(
          "emailEncrypted firstNameEncrypted lastNameEncrypted phoneEncrypted specialization",
        );

      if (doctor) {
        decryptedDoctorInfo = {
          ...doctor.toObject(),
          firstName: decrypt(doctor.firstNameEncrypted),
          lastName: decrypt(doctor.lastNameEncrypted),
          email: decrypt(doctor.emailEncrypted),
          phoneNumber: decrypt(doctor.phoneEncrypted),
          specialization: doctor.specialization?.name || "Неизвестно",
        };

        doctorProfileInfo = await DoctorProfile.findOne({
          userId: patient.doctorId,
        }).select("company speciality clinic profileImage country phoneNumber");
      }
    }

    return res.status(200).json({
      patient,
      doctor: decryptedDoctorInfo,
      doctorSpecialization: decryptedDoctorInfo?.specialization || "Неизвестно",
      medicalHistory: decryptedMedicalHistory,
      doctorProfile: doctorProfileInfo || null,
    });
  } catch (err) {
    console.error("❌ patientsMedicalHistoryGetController error:", err);
    return res.status(500).json({ message: "Ошибка сервера" });
  }
};

export default patientsMedicalHistoryGetController;
