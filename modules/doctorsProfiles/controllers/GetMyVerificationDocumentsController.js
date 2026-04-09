// GetMyVerificationDocumentsController.js
import DoctorVerificationDocument from "../../../common/models/DoctorVerification/DocumentFiles.js";
import DoctorProfile from "../../../common/models/DoctorProfile/profileDoctor.js";

const GetMyVerificationDocumentsController = async (req, res) => {
  try {
    const userId = req.session.userId;

    if (!userId) {
      return res.status(401).json({ success: false });
    }

    const doctorProfile = await DoctorProfile.findOne({ userId });

    if (!doctorProfile) {
      return res.status(404).json({ success: false });
    }

    const documents = await DoctorVerificationDocument.find({
      doctorProfileId: doctorProfile._id,
      isArchivedByDoctor: { $ne: true },
    }).sort({ createdAt: -1 });

    res.json({ success: true, documents });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export default GetMyVerificationDocumentsController;
