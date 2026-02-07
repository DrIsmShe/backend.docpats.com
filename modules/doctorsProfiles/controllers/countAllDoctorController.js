import Doctor from "../../../common/models/Auth/users.js";

const countAllDoctorController = async (req, res) => {
  try {
    const totalDoctors = await Doctor.countDocuments({ role: "doctor" }); // Подсчет только докторов

    res.status(200).json({ count: totalDoctors });
  } catch (error) {
    console.error("Error counting doctors:", error);
    res.status(500).json({ message: "Server error counting doctors" });
  }
};

export default countAllDoctorController;
