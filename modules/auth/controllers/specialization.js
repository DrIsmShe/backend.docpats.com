import Specialization from "../../../common/models/DoctorProfile/specialityOfDoctor.js";

const getSpecializationDoctorController = async (req, res) => {
  try {
    const specializations = await Specialization.find();
    if (!specializations.length) {
      return res.status(404).json({ message: "No specializations found" });
    }
    res.status(200).json(specializations);
  } catch (error) {
    console.error("Error fetching specializations:", error);
    res.status(500).json({ message: "Server error" });
  }
}; // Get all specializations

export default getSpecializationDoctorController;
