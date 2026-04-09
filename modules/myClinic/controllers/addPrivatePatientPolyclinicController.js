import DoctorPrivatePatient from "../../../common/models/Polyclinic/DoctorPrivatePatient.js";
import DoctorProfile from "../../../common/models/DoctorProfile/profileDoctor.js";
import crypto from "crypto";

const sha256Lower = (v) =>
  crypto
    .createHash("sha256")
    .update(String(v || "").toLowerCase())
    .digest("hex");

const normalizePhone = (v) => String(v || "").replace(/[^\d+]/g, "");

const addPrivatePatientPolyclinicController = async (req, res) => {
  try {
    if (!req.user || req.user.role !== "doctor") {
      return res.status(403).json({
        message: "Only doctors can add private patients",
      });
    }

    const doctorProfile = await DoctorProfile.findOne({
      userId: req.user.userId,
      isDeleted: { $ne: true },
    }).select("_id");

    if (!doctorProfile) {
      return res.status(404).json({
        message: "Doctor profile not found",
      });
    }

    const {
      firstName,
      lastName,
      email,
      phoneNumber,
      gender,
      birthDate,
      identityDocument,
      country,
      address,
      immunization,
      allergies,
      chronicDiseases,
      familyHistoryOfDisease,
      operations,
      badHabits,
      about,
    } = req.body;

    if (!firstName || !lastName) {
      return res.status(400).json({
        message: "First name and last name are required",
      });
    }

    // ===============================
    // 🔍 DUPLICATE CHECK
    // ===============================

    const conditions = [];

    if (email) {
      const emailHash = sha256Lower(email.trim().toLowerCase());
      conditions.push({ emailHash });
    }

    if (phoneNumber) {
      const phoneHash = sha256Lower(normalizePhone(phoneNumber));
      conditions.push({ phoneHash });
    }

    if (identityDocument) {
      conditions.push({ externalId: identityDocument.trim() });
    }

    if (conditions.length > 0) {
      const existing = await DoctorPrivatePatient.findOne({
        doctorUserId: req.user.userId,
        isDeleted: { $ne: true },
        $or: conditions,
      }).select("_id emailHash phoneHash externalId");

      if (existing) {
        return res.status(409).json({
          success: false,
          code: "DUPLICATE_PATIENT",
          message:
            "Patient with the same email, phone number, or ID document already exists.",
        });
      }
    }

    // ===============================
    // 📸 IMAGE
    // ===============================

    let image = null;
    if (req.file?.location) image = req.file.location;
    else if (req.file?.path) image = req.file.path;

    // ===============================
    // 🧠 CREATE
    // ===============================

    const privatePatient = await DoctorPrivatePatient.create({
      doctorProfileId: doctorProfile._id,
      doctorUserId: req.user.userId,

      firstName,
      lastName,
      email,
      phoneNumber,

      gender,
      dateOfBirth: birthDate || null,
      externalId: identityDocument || null,

      address: {
        country: country || null,
        street: address || null,
      },

      medicalProfile: {
        immunization,
        allergies,
        chronicDiseases,
        familyHistoryOfDisease,
        operations,
        badHabits,
        about,
      },

      image,
      createdBy: req.user.userId,
    });

    return res.status(201).json({
      success: true,
      patientId: privatePatient._id,
      message: "Private patient added successfully",
    });
  } catch (error) {
    console.error("❌ addPrivatePatient error:", error);

    return res.status(500).json({
      message: "Failed to add private patient",
    });
  }
};

export default addPrivatePatientPolyclinicController;
