// server/modules/admin/controllers/PolyclinicPatientsChartController.js
import NewPatientPolyclinic from "../../../common/models/Polyclinic/newPatientPolyclinic.js";

/**
 * @route   GET /admin/polyclinic-static/patients-chart/:period
 * @desc    Возвращает статистику количества добавленных пациентов по дням / неделям / месяцам / годам
 * @access  Admin / Doctor
 * @param   period = day | week | month | year
 */
export const DoctorsChartController = async (req, res) => {
  try {
    const { period } = req.params;

    // Проверка параметра
    const allowedPeriods = ["day", "week", "month", "year"];
    if (!allowedPeriods.includes(period)) {
      return res.status(400).json({
        success: false,
        message: "Неверный период. Используйте: day, week, month или year.",
      });
    }

    // Загружаем всех пациентов с датами
    const patients = await NewPatientPolyclinic.find({}, "createdAt");

    if (!patients.length) {
      return res.status(200).json({
        success: true,
        data: [],
        message: "Нет данных для построения графика",
      });
    }

    // Группировка по периоду
    const grouped = {};

    patients.forEach((p) => {
      const date = new Date(p.createdAt);
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
          firstDay.setDate(date.getDate() - date.getDay()); // начало недели (воскресенье)
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

        default:
          key = date.toLocaleDateString();
      }

      grouped[key] = (grouped[key] || 0) + 1;
    });

    // Преобразуем объект в массив для удобства фронта
    const sortedData = Object.entries(grouped)
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => {
        // сортировка по дате (если возможно)
        return new Date(a.label) - new Date(b.label);
      });

    return res.status(200).json({
      success: true,
      data: sortedData,
    });
  } catch (error) {
    console.error("Ошибка при формировании статистики:", error);
    return res.status(500).json({
      success: false,
      message: "Ошибка при получении статистики пациентов",
      error: error.message,
    });
  }
};
