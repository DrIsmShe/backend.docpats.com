import NewPatientPolyclinic from "../../../common/models/Polyclinic/newPatientPolyclinic.js";

/**
 * @route   GET /admin/polyclinic-static/patients-chart-country/:period
 * @desc    Возвращает статистику изменения количества пациентов по странам
 *          с группировкой по дням, неделям, месяцам или годам
 * @access  Admin / Doctor
 */
export const PolyclinicPatientsChartCountryController = async (req, res) => {
  try {
    const { period } = req.params;

    const allowedPeriods = ["day", "week", "month", "year"];
    if (!allowedPeriods.includes(period)) {
      return res.status(400).json({
        success: false,
        message: "Неверный период. Используйте: day, week, month или year.",
      });
    }

    // === 🔹 Определяем временной диапазон ===
    const now = new Date();
    let startDate = new Date();

    switch (period) {
      case "day":
        startDate.setDate(now.getDate() - 1);
        break;
      case "week":
        startDate.setDate(now.getDate() - 7);
        break;
      case "month":
        startDate.setMonth(now.getMonth() - 1);
        break;
      case "year":
        startDate.setFullYear(now.getFullYear() - 1);
        break;
    }

    // === 🔹 Формат даты для группировки ===
    const dateFormat =
      period === "day"
        ? "%Y-%m-%d"
        : period === "week"
        ? "%Y-%U"
        : period === "month"
        ? "%Y-%m"
        : "%Y";

    // === 🔹 Агрегация ===
    const stats = await NewPatientPolyclinic.aggregate([
      // 1️⃣ фильтрация по диапазону дат
      {
        $match: {
          createdAt: { $gte: startDate, $lte: now },
        },
      },
      // 2️⃣ группировка по стране и периоду
      {
        $group: {
          _id: {
            period: {
              $dateToString: { format: dateFormat, date: "$createdAt" },
            },
            country: { $ifNull: ["$country", "Не указано"] },
          },
          count: { $sum: 1 },
        },
      },
      // 3️⃣ группировка по странам
      {
        $group: {
          _id: "$_id.country",
          data: {
            $push: {
              period: "$_id.period",
              count: "$count",
            },
          },
          total: { $sum: "$count" },
        },
      },
      { $sort: { total: -1 } },
    ]);

    // === 🔹 Преобразуем в удобный формат ===
    const formatted = stats.map((item) => ({
      country: item._id,
      total: item.total,
      timeline: item.data.sort((a, b) => a.period.localeCompare(b.period)),
    }));

    res.status(200).json({
      success: true,
      data: formatted,
      message: `Статистика пациентов по странам (${period}) успешно загружена.`,
    });
  } catch (error) {
    console.error("❌ Ошибка при загрузке статистики по странам:", error);
    res.status(500).json({
      success: false,
      message: "Ошибка сервера при загрузке статистики по странам.",
      error: error.message,
    });
  }
};
