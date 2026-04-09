// server/modules/clinic/controllers/countPatientsController.js

import mongoose from "mongoose";
import NewPatientPolyclinic from "../../../common/models/Polyclinic/newPatientPolyclinic.js";
import DoctorPrivatePatient from "../../../common/models/Polyclinic/DoctorPrivatePatient.js";

const countPatientsController = async (req, res) => {
  try {
    const doctorId = req.userId;

    if (!doctorId || !mongoose.Types.ObjectId.isValid(doctorId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid doctor id",
      });
    }

    const doctorObjectId = new mongoose.Types.ObjectId(doctorId);

    const registeredCount = await NewPatientPolyclinic.countDocuments({
      doctorId: doctorObjectId,
      isDeleted: false,
      isArchived: false,
    });

    const privateCount = await DoctorPrivatePatient.countDocuments({
      doctorUserId: doctorObjectId,
      isDeleted: false,
      isArchived: false,
    });

    return res.status(200).json({
      success: true,
      data: {
        totalPatients: registeredCount + privateCount,
        registeredPatients: registeredCount,
        privatePatients: privateCount,
      },
    });
  } catch (error) {
    console.error("countPatientsController error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to count patients",
    });
  }
};

export default countPatientsController;
