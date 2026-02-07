import LabTest from "../../../../common/models/Polyclinic/ExamenationsTemplates/Labtest/LabTest.js";
import { decrypt } from "../../../../common/models/Auth/users.js";
import dayjs from "dayjs";

const getDetailExaminationsControllerLabtest = async (req, res) => {
  const { id } = req.params;
  const timestamp = dayjs().format("YYYY-MM-DD HH:mm:ss");

  console.log(
    `[${timestamp}] 🔍 [LabTest] Запрос детальной информации по анализу ID: ${id}`
  );

  try {
    const labTest = await LabTest.findById(id)
      .populate("patient", "firstNameEncrypted lastNameEncrypted birthDate")
      .populate("doctor", "firstNameEncrypted lastNameEncrypted role")
      .populate("files")
      .populate(
        "doctorComments.doctor",
        "firstNameEncrypted lastNameEncrypted role"
      );

    if (!labTest) {
      return res.status(404).json({ message: "Лабораторный тест не найден" });
    }

    const labTestObj = labTest.toObject();

    // 🔓 Расшифровка врача
    if (labTestObj.doctor?.firstNameEncrypted) {
      labTestObj.doctor.firstName = decrypt(
        labTestObj.doctor.firstNameEncrypted
      );
      labTestObj.doctor.lastName = decrypt(labTestObj.doctor.lastNameEncrypted);
    }

    // 🔓 Расшифровка пациента
    if (labTestObj.patient?.firstNameEncrypted) {
      labTestObj.patient.firstName = decrypt(
        labTestObj.patient.firstNameEncrypted
      );
      labTestObj.patient.lastName = decrypt(
        labTestObj.patient.lastNameEncrypted
      );
    }

    // 🔓 Расшифровка комментариев врачей
    if (labTestObj.doctorComments?.length > 0) {
      labTestObj.doctorComments = labTestObj.doctorComments.map((comment) => {
        if (comment.doctor?.firstNameEncrypted) {
          comment.doctor.firstName = decrypt(comment.doctor.firstNameEncrypted);
          comment.doctor.lastName = decrypt(comment.doctor.lastNameEncrypted);
        }
        return comment;
      });
    }

    console.log(`[${timestamp}] ✅ Детали анализа успешно получены`);

    res.status(200).json({
      success: true,
      data: labTestObj,
      message: "Детали лабораторного теста успешно получены",
    });
  } catch (error) {
    console.error(
      `[${timestamp}] ❌ Ошибка получения LabTest: ${error.message}`
    );
    res.status(500).json({
      success: false,
      message: "Ошибка сервера при получении лабораторного теста",
      error: error.message,
    });
  }
};

export default getDetailExaminationsControllerLabtest;
