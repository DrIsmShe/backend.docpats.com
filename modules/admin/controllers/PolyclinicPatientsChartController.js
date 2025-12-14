import NewPatientPolyclinic from "../../../common/models/Polyclinic/newPatientPolyclinic.js";

/**
 * @route   GET /admin/polyclinic-static/patients-chart/:period
 * @desc    Возвращает статистику количества зарегистрированных пациентов по дням / неделям / месяцам / годам
 * @access  Admin / Doctor
 */
export const PolyclinicPatientsChartController = async (req, res) => {
  try {
    const { period } = req.params;
    const allowedPeriods = ["day", "week", "month", "year"];

    if (!allowedPeriods.includes(period)) {
      return res.status(400).json({
        success: false,
        message: "Неверный период. Используйте: day, week, month или year.",
      });
    }

    // Загружаем всех пациентов
    const patients = await NewPatientPolyclinic.find({}, "createdAt");

    if (!patients.length) {
      return res.status(200).json({
        success: true,
        data: [],
        message: "Нет данных для построения графика",
      });
    }

    const grouped = {};

    patients.forEach((pat) => {
      const date = new Date(pat.createdAt);
      let key;

      switch (period) {
        case "day":
          key = date.toLocaleDateString("ru-RU", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
          });
          break;
        case "week": {
          const firstDay = new Date(date);
          const day = firstDay.getDay();
          const diff = (day === 0 ? -6 : 1) - day;
          firstDay.setDate(firstDay.getDate() + diff);
          const weekStart = firstDay.toLocaleDateString("ru-RU", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
          });
          key = `Неделя от ${weekStart}`;
          break;
        }
        case "month":
          key = date.toLocaleDateString("ru-RU", {
            month: "long",
            year: "numeric",
          });
          break;
        case "year":
          key = date.getFullYear().toString();
          break;
      }

      grouped[key] = (grouped[key] || 0) + 1;
    });

    const sortedData = Object.entries(grouped)
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => new Date(a.label) - new Date(b.label));

    return res.status(200).json({ success: true, data: sortedData });
  } catch (error) {
    console.error("Ошибка при формировании статистики пациентов:", error);
    return res.status(500).json({
      success: false,
      message: "Ошибка при получении статистики пациентов",
      error: error.message,
    });
  }
};
