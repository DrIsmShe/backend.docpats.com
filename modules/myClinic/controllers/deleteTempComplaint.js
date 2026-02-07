import TempComplaints from "../../../common/models/Polyclinic/TempResults/tempComplaints.js";

const deleteTempComplaint = async (req, res) => {
  try {
    const { id } = req.params;

    // Проверяем, существует ли шаблон жалобы
    const complaint = await TempComplaints.findById(id);
    if (!complaint) {
      return res.status(404).json({ message: "Шаблон жалобы не найден" });
    }

    // Удаляем шаблон
    await TempComplaints.findByIdAndDelete(id);

    return res.status(200).json({ message: "Шаблон жалобы успешно удален" });
  } catch (error) {
    console.error("Ошибка при удалении шаблона жалобы:", error);
    return res.status(500).json({ message: "Внутренняя ошибка сервера" });
  }
};

export default deleteTempComplaint;
