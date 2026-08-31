import TempComplaints from "../../../common/models/Polyclinic/TempResults/tempComplaints.js";
import { tReq } from "../../../common/i18n/index.js";

const deleteTempComplaint = async (req, res) => {
  try {
    const { id } = req.params;

    // Проверяем, существует ли шаблон жалобы
    const complaint = await TempComplaints.findById(id);
    if (!complaint) {
      return res.status(404).json({ message: tReq(req, "myClinic.complaintTemplate.notFound") });
    }

    // Удаляем шаблон
    await TempComplaints.findByIdAndDelete(id);

    return res.status(200).json({ message: tReq(req, "myClinic.complaintTemplate.deleteSuccess") });
  } catch (error) {
    console.error("Ошибка при удалении шаблона жалобы:", error);
    return res.status(500).json({ message: tReq(req, "myClinic.server.internalError") });
  }
};

export default deleteTempComplaint;
