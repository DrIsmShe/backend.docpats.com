import DoctorPrivatePatient from "../../../common/models/Polyclinic/DoctorPrivatePatient.js";
import DoctorProfile from "../../../common/models/DoctorProfile/profileDoctor.js";

/**
 * Add private patient (NEW MODEL COMPATIBLE)
 */
const addPrivatePatientPolyclinicController = async (req, res) => {
  try {
    // =====================================================
    // 1. Auth / role check
    // =====================================================
    const user = req.user;

    if (!user || user.role !== "doctor") {
      return res.status(403).json({
        message: "Only doctors can add private patients",
      });
    }

    // =====================================================
    // 2. Doctor profile
    // =====================================================
    const doctorProfile = await DoctorProfile.findOne({
      $or: [
        { userId: user.userId },
        { user: user.userId },
        { doctorUserId: user.userId },
      ],
      isDeleted: { $ne: true },
    }).select("_id");

    if (!doctorProfile) {
      return res.status(404).json({
        message: "Doctor profile not found",
      });
    }

    // =====================================================
    // 3. Request body (PLAIN DATA)
    // =====================================================
    const {
      email,
      phoneNumber,
      identityDocument,

      firstName,
      lastName,
      gender,
      birthDate,

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

    // =====================================================
    // 4. Validation
    // =====================================================
    if (!firstName || !lastName) {
      return res.status(400).json({
        message: "First name and last name are required",
      });
    }

    // =====================================================
    // 5. Duplicate check (by phoneHash via MODEL)
    // =====================================================

    // =====================================================
    // 6. Image
    // =====================================================
    let image = null;
    if (req.file?.location) image = req.file.location;
    else if (req.file?.path) image = req.file.path;

    // =====================================================
    // 7. Create private patient (PLAIN FIELDS)
    // =====================================================
    const privatePatient = await DoctorPrivatePatient.create({
      doctorProfileId: doctorProfile._id,
      doctorUserId: user.userId,

      // виртуалы
      firstName,
      lastName,
      email,
      phoneNumber,

      gender,
      dateOfBirth: birthDate || null,
      externalId: identityDocument || null, // паспорт / ID пациента

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
      createdBy: user.userId,
    });

    // =====================================================
    // 8. Response
    // =====================================================
    return res.status(201).json({
      success: true,
      message: "Private patient added successfully",
      patientId: privatePatient._id,
      migrationStatus: privatePatient.migrationStatus, // ← на будущее
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        message: "Private patient with same phone or email already exists",
      });
    }

    console.error("❌ addPrivatePatientPolyclinicController:", error);

    return res.status(500).json({
      message: "Failed to add private patient",
      error: error.message,
    });
  }
};

export default addPrivatePatientPolyclinicController;
