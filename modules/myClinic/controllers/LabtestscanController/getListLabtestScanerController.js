import LabTest from "../../../../common/models/Polyclinic/ExamenationsTemplates/Labtest/LabTest.js";
import User, { decrypt } from "../../../../common/models/Auth/users.js";
import dayjs from "dayjs";

const getListLabtestScanerController = async (req, res) => {
  const { id } = req.params; // ID пациента
  const timestamp = dayjs().format("YYYY-MM-DD HH:mm:ss");

  console.log(
    `[${timestamp}] 🔍 [LabTest] Запрос на список лабораторных тестов для пациента ${id}`
  );

  try {
    const labTestsRaw = await LabTest.find({ patient: id })
      .populate("patient", "firstNameEncrypted lastNameEncrypted birthDate")
      .populate("doctor", "firstNameEncrypted lastNameEncrypted birthDate")
      .populate("files");

    // 🔓 Расшифровка имён
    const labTests = labTestsRaw.map((test) => {
      const testObj = test.toObject();

      if (testObj.doctor && testObj.doctor.firstNameEncrypted) {
        testObj.doctor.firstName = decrypt(testObj.doctor.firstNameEncrypted);
        testObj.doctor.lastName = decrypt(testObj.doctor.lastNameEncrypted);
      }

      if (testObj.patient && testObj.patient.firstNameEncrypted) {
        testObj.patient.firstName = decrypt(testObj.patient.firstNameEncrypted);
        testObj.patient.lastName = decrypt(testObj.patient.lastNameEncrypted);
      }

      return testObj;
    });

    console.log(
      `[${timestamp}] ✅ Получено ${labTests.length} лабораторных анализов`
    );

    res.status(200).json({
      success: true,
      count: labTests.length,
      data: labTests,
      message: "Список лабораторных анализов успешно получен",
    });
  } catch (error) {
    console.error(
      `[${timestamp}] ❌ Ошибка получения LabTest: ${error.message}`
    );
    res.status(500).json({
      success: false,
      message: "Ошибка при получении лабораторных тестов",
      error: error.message,
    });
  }
};

export default getListLabtestScanerController;
