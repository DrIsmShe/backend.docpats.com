import Doctor from "../../models/users.js";

const countAllDoctorController = async (req, res) => {
  try {
    const totalDoctors = await Doctor.countDocuments({ role: "doctor" }); // Подсчет только докторов

    res.status(200).json({ count: totalDoctors });
  } catch (error) {
    console.error("Ошибка при подсчете докторов:", error);
    res.status(500).json({ message: "Ошибка сервера при подсчете докторов" });
  }
};

export default countAllDoctorController;
