import DoctorProfile from "../../../common/models/profileDoctor.js";

/**
 * @route   GET /admin/polyclinic-static/doctors-chart/:period
 * @desc    Возвращает статистику количества зарегистрированных врачей по дням / неделям / месяцам / годам
 * @access  Admin / Doctor
 */
export const DoctorsPatientsChartController = async (req, res) => {
  try {
    const { period } = req.params;

    // Разрешённые периоды
    const allowedPeriods = ["day", "week", "month", "year"];
    if (!allowedPeriods.includes(period)) {
      return res.status(400).json({
        success: false,
        message: "Неверный период. Используйте: day, week, month или year.",
      });
    }

    // Загружаем всех врачей с датой создания профиля
    const doctors = await DoctorProfile.find({}, "createdAt");

    if (!doctors.length) {
      return res.status(200).json({
        success: true,
        data: [],
        message: "Нет данных для построения графика",
      });
    }

    // Группировка по выбранному периоду
    const grouped = {};

    doctors.forEach((doc) => {
      const date = new Date(doc.createdAt);
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
          // Определяем начало недели (понедельник)
          const firstDay = new Date(date);
          const day = firstDay.getDay(); // 0 (вс) - 6 (сб)
          const diff = (day === 0 ? -6 : 1) - day; // смещение до понедельника
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

        default:
          key = date.toLocaleDateString("ru-RU");
      }

      grouped[key] = (grouped[key] || 0) + 1;
    });

    // Преобразуем объект в массив и сортируем по времени
    const sortedData = Object.entries(grouped)
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => {
        // Пытаемся отсортировать по дате, если возможно
        const da = new Date(a.label.replace(/[^\d\.]/g, ""));
        const db = new Date(b.label.replace(/[^\d\.]/g, ""));
        return da - db;
      });

    return res.status(200).json({
      success: true,
      data: sortedData,
    });
  } catch (error) {
    console.error("Ошибка при формировании статистики докторов:", error);
    return res.status(500).json({
      success: false,
      message: "Ошибка при получении статистики докторов",
      error: error.message,
    });
  }
};
