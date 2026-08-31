import Doctor from "../../models/users.js";
import { tReq } from "../../../common/i18n/index.js";

const countAllDoctorController = async (req, res) => {
  try {
    const totalDoctors = await Doctor.countDocuments({ role: "doctor" }); // Подсчет только докторов

    res.status(200).json({ count: totalDoctors });
  } catch (error) {
    console.error("Ошибка при подсчете докторов:", error);
    res.status(500).json({ message: tReq(req, "app.doctors.countError") });
  }
};

export default countAllDoctorController;
