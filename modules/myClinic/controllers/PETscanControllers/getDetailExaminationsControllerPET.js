import PETScan from "../../../../common/models/Polyclinic/ExamenationsTemplates/PETScansTemplates/PETScan.js";

const getDetailExaminationsControllerPET = async (req, res) => {
  try {
    const { id } = req.params;

    const petScan = await PETScan.findById(id)
      .populate("patientId", "-__v -createdAt -updatedAt")
      .populate("doctor", "-password -__v")
      .populate("reportTemplate")
      .populate("diagnosisTemplate")
      .populate("recomandationTemplate")
      .populate(
        "doctorComments.doctor",
        "firstNameEncrypted lastNameEncrypted role"
      );

    if (!petScan) {
      return res.status(404).json({ message: "Исследование не найдено" });
    }

    if (petScan.doctor?.decryptFields) {
      petScan.doctor = petScan.doctor.decryptFields();
    }

    if (petScan.doctorComments?.length > 0) {
      petScan.doctorComments = petScan.doctorComments.map((comment) => {
        if (comment.doctor?.decryptFields) {
          comment.doctor = comment.doctor.decryptFields();
        }
        return comment;
      });
    }

    res.status(200).json(petScan);
  } catch (error) {
    console.error("Ошибка при получении PET-исследования:", error);
    res.status(500).json({ message: "Ошибка сервера", error: error.message });
  }
};

export default getDetailExaminationsControllerPET;
