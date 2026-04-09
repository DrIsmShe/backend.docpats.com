import LabTest from "../../../../common/models/Polyclinic/ExamenationsTemplates/Labtest/LabTest.js";
import { decrypt } from "../../../../common/models/Auth/users.js";
import dayjs from "dayjs";

const getListLabtestScanerController = async (req, res) => {
  const timestamp = dayjs().format("YYYY-MM-DD HH:mm:ss");
  const { patient } = req; // 🔥 ТОЛЬКО ТАК (resolvePatient)

  if (!patient) {
    return res.status(404).json({
      success: false,
      message: "Пациент не найден",
    });
  }

  console.log(
    `[${timestamp}] 🔍 [LabTest] Запрос списка лабораторных тестов для пациента ${patient._id}`,
  );

  try {
    const labTestsRaw = await LabTest.find({
      patient: patient._id, // ✅ ЕДИНСТВЕННЫЙ ПРАВИЛЬНЫЙ ФИЛЬТР
    })
      .sort({ createdAt: -1 })
      .populate("patient", "firstNameEncrypted lastNameEncrypted birthDate")
      .populate(
        "doctor",
        "firstNameEncrypted lastNameEncrypted birthDate specialization",
      )
      .populate("files");

    const labTests = labTestsRaw.map((test) => {
      const testObj = test.toObject();

      if (testObj.doctor?.firstNameEncrypted) {
        testObj.doctor.firstName = decrypt(testObj.doctor.firstNameEncrypted);
        testObj.doctor.lastName = decrypt(testObj.doctor.lastNameEncrypted);
      }

      if (testObj.patient?.firstNameEncrypted) {
        testObj.patient.firstName = decrypt(testObj.patient.firstNameEncrypted);
        testObj.patient.lastName = decrypt(testObj.patient.lastNameEncrypted);
      }

      return testObj;
    });

    console.log(
      `[${timestamp}] ✅ Найдено лабораторных анализов: ${labTests.length}`,
    );

    res.status(200).json({
      success: true,
      count: labTests.length,
      data: labTests,
    });
  } catch (error) {
    console.error(`[${timestamp}] ❌ Ошибка получения LabTest:`, error);
    res.status(500).json({
      success: false,
      message: "Ошибка при получении лабораторных тестов",
      error: error.message,
    });
  }
};

export default getListLabtestScanerController;
