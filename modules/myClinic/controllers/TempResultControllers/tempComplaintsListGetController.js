import TempComplaints from "../../../../common/models/Polyclinic/TempResults/tempComplaints.js";
import { tReq } from "../../../../common/i18n/index.js";

const tempComplaintsListGetController = async (req, res) => {
  try {
    const tempComplaints = await TempComplaints.find();

    if (!tempComplaints) {
      return res.status(404).json({ message: tReq(req, "myClinic.patient.notFound4") });
    }

    return res.status(200).json(tempComplaints);
  } catch (err) {
    console.error("Ошибка при получении информации о пациентах:", err);
    return res.status(500).json({ message: tReq(req, "myClinic.server.error2") });
  }
};
export default tempComplaintsListGetController;
