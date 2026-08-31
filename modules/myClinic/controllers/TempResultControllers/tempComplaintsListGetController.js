import TempComplaints from "../../../../common/models/Polyclinic/TempResults/tempComplaints.js";

const tempComplaintsListGetController = async (req, res) => {
  try {
    const tempComplaints = await TempComplaints.find();

    if (!tempComplaints) {
      return res.status(404).json({ message: req.t("myClinic.patient.notFound4") });
    }

    return res.status(200).json(tempComplaints);
  } catch (err) {
    console.error("Ошибка при получении информации о пациентах:", err);
    return res.status(500).json({ message: req.t("myClinic.server.error2") });
  }
};
export default tempComplaintsListGetController;
