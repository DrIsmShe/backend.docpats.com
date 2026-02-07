// 📁 controllers/LabtestscanController/getLatestLabtestController.js
import LabTest from "../../../../common/models/Polyclinic/ExamenationsTemplates/Labtest/LabTest.js";
import dayjs from "dayjs";

const getLatestLabtestController = async (req, res) => {
  const { patientId } = req.params;

  if (!patientId) {
    return res.status(400).json({
      success: false,
      message: "Не передан ID пациента",
    });
  }

  try {
    const latestLabTest = await LabTest.findOne({ patient: patientId })
      .sort({ date: -1 })
      .select("testParameters testType")
      .lean();

    if (!latestLabTest) {
      return res.status(404).json({
        success: false,
        message: "У пациента нет предыдущих анализов",
      });
    }

    return res.status(200).json({
      success: true,
      data: latestLabTest,
    });
  } catch (error) {
    console.error("❌ Ошибка при получении последнего анализа:", error);
    return res.status(500).json({
      success: false,
      message: "Ошибка сервера",
      error: error.message,
    });
  }
};

export default getLatestLabtestController;
