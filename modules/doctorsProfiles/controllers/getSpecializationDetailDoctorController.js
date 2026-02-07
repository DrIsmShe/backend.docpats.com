import ProfileDoctor from "../../../common/models/DoctorProfile/profileDoctor.js";

const getSpecializationDoctorController = async (req, res) => {
  const { id } = req.params; // ID врача

  try {
    const doctor = await ProfileDoctor.findById(id).populate({
      path: "specialization",
      select: "name category", // Выбираем только нужные поля
    });

    if (!doctor) {
      return res.status(404).json({ message: "Doctor not found" });
    }

    console.log("Doctor's specialization:", doctor.specialization);

    res.status(200).json({
      id: doctor.specialization?._id,
      name: doctor.specialization?.name,
      category: doctor.specialization?.category,
    });
  } catch (error) {
    console.error("Error fetching doctor's specialization:", error);
    res.status(500).json({ message: "Server error" });
  }
};

export default getSpecializationDoctorController;
