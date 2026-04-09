import mongoose from "mongoose";
import User, { decrypt } from "../../../common/models/Auth/users.js";
import ProfileDoctor from "../../../common/models/DoctorProfile/profileDoctor.js";
import DoctorVerificationDocument from "../../../common/models/DoctorVerification/DocumentFiles.js";

const getDoctorVerificationDocumentsController = async (req, res) => {
  try {
    const { doctorId } = req.params;

    /* ========================= VALIDATION ========================= */
    if (!mongoose.Types.ObjectId.isValid(doctorId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid doctor ID format",
      });
    }

    /* ========================= USER ========================= */
    const user = await User.findById(doctorId).lean();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Doctor not found",
      });
    }

    /* ========================= DOCTOR PROFILE ========================= */
    const doctorProfile = await ProfileDoctor.findOne({
      userId: doctorId,
    }).lean();

    if (!doctorProfile) {
      return res.status(404).json({
        success: false,
        message: "Doctor profile not found",
      });
    }

    /* ========================= DOCUMENTS ========================= */
    const documents = await DoctorVerificationDocument.find({
      userId: doctorId,
    })
      .sort({ createdAt: -1 })
      .lean();

    /* ========================= RESPONSE ========================= */
    const decryptedDoctor = {
      _id: user._id,
      firstName: user.firstNameEncrypted
        ? decrypt(user.firstNameEncrypted)
        : null,
      lastName: user.lastNameEncrypted ? decrypt(user.lastNameEncrypted) : null,
      email: user.emailEncrypted ? decrypt(user.emailEncrypted) : null,
      role: user.role,
    };

    return res.status(200).json({
      success: true,
      doctor: decryptedDoctor,
      doctorProfile: {
        _id: doctorProfile._id,
        clinic: doctorProfile.clinic,
        company: doctorProfile.company,
        country: doctorProfile.country,
        verificationStatus: doctorProfile.verificationStatus,
        isVerified: doctorProfile.isVerified,
        verificationReviewedBy: doctorProfile.verificationReviewedBy,
        verificationReviewedAt: doctorProfile.verificationReviewedAt,
        verificationReviewComment: doctorProfile.verificationReviewComment,
      },
      totalDocuments: documents.length,
      documents,
    });
  } catch (error) {
    console.error("❌ Error fetching doctor verification documents:", error);

    return res.status(500).json({
      success: false,
      message: "Server error while fetching doctor verification documents",
      error: error.message,
    });
  }
};

export default getDoctorVerificationDocumentsController;
