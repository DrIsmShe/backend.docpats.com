import DoctorPrivatePatient from "../../../common/models/Polyclinic/DoctorPrivatePatient.js";

/**
 * GET private patients (polyclinic)
 * GET /clinic/private-patients-polyclinic
 */
const getPrivatePatientsPolyclinicController = async (req, res) => {
  try {
    /* =====================================================
       1. AUTH & ROLE
    ===================================================== */
    const user = req.user;

    if (!user || user.role !== "doctor") {
      return res.status(403).json({
        message: "Only doctors can access private patients",
      });
    }

    /* =====================================================
       2. QUERY PARAMS
    ===================================================== */
    const {
      page = 1,
      limit = 20,
      search = "",
      archived = "false",
      sort = "createdAt",
      order = "desc",
    } = req.query;

    const skip = (Number(page) - 1) * Number(limit);

    /* =====================================================
       3. BASE FILTER
    ===================================================== */
    const filter = {
      doctorUserId: user.userId,
      migrationStatus: "private",
      isArchived: archived === "true",
    };

    /* =====================================================
       4. SEARCH (name / phone / email)
    ===================================================== */
    if (search) {
      filter.$or = [
        { firstNameHash: { $regex: search.toLowerCase() } },
        { lastNameHash: { $regex: search.toLowerCase() } },
        { phoneHash: { $regex: search.toLowerCase() } },
        { emailHash: { $regex: search.toLowerCase() } },
      ];
    }

    /* =====================================================
       5. QUERY
    ===================================================== */
    const [patients, total] = await Promise.all([
      DoctorPrivatePatient.find(filter)
        .sort({ [sort]: order === "asc" ? 1 : -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean({ virtuals: true }),

      DoctorPrivatePatient.countDocuments(filter),
    ]);

    /* =====================================================
       6. RESPONSE
    ===================================================== */
    return res.status(200).json({
      page: Number(page),
      limit: Number(limit),
      total,
      pages: Math.ceil(total / limit),
      patients,
    });
  } catch (error) {
    console.error("❌ getPrivatePatientsPolyclinicController:", error);

    return res.status(500).json({
      message: "Failed to load private patients",
    });
  }
};

export default getPrivatePatientsPolyclinicController;
