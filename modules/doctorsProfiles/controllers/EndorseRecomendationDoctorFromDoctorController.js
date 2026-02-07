import DoctorEndorsement from "../../../common/models/DoctorProfile/doctorEndorsement.js";
import User, {
  decrypt as decryptField,
} from "../../../common/models/Auth/users.js";

/**
 * ---------------------------------------------------------
 * 1. ДОБАВИТЬ РЕКОМЕНДАЦИЮ (ТОЛЬКО ОДИН РАЗ)
 * POST /doctor-profile/api/recommendations-from-doctor/add/:toDoctorId
 * ---------------------------------------------------------
 */
export const endorseDoctor = async (req, res) => {
  try {
    const fromDoctorId = req.userId;
    const toDoctorId = req.params.toDoctorId;
    const { comment } = req.body;

    if (!fromDoctorId)
      return res.status(401).json({ message: "User not authenticated." });

    if (fromDoctorId.toString() === toDoctorId.toString()) {
      return res.status(400).json({ message: "You cannot endorse yourself." });
    }

    const targetDoctor = await User.findById(toDoctorId);
    if (!targetDoctor || targetDoctor.role !== "doctor") {
      return res.status(404).json({ message: "Target doctor not found." });
    }

    // Проверяем существует ли уже рекомендация
    const exists = await DoctorEndorsement.findOne({
      fromDoctorId,
      toDoctorId,
    });

    if (exists) {
      return res.status(400).json({
        success: false,
        message: "You already endorsed this doctor.",
      });
    }

    // 🔥 Берём врача, оставляющего рекомендацию, вместе с его SPECIALIZATION
    const fromDoctor = await User.findById(fromDoctorId)
      .populate("specialization", "name")
      .lean();

    const specializationId = fromDoctor.specialization?._id || null;
    const specializationName = fromDoctor.specialization?.name || null;

    // Создаём рекомендацию
    const endorsement = await DoctorEndorsement.create({
      fromDoctorId,
      toDoctorId,
      specializationId,
      specializationName, // <-- сохраняем название
      comment: comment || "",
    });

    return res.json({
      success: true,
      message: "Doctor endorsed successfully!",
      endorsement,
    });
  } catch (err) {
    console.error("❌ Endorse doctor error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * ---------------------------------------------------------
 * 2. ОБНОВИТЬ ТОЛЬКО КОММЕНТАРИЙ
 * PUT /doctor-profile/api/recommendations-from-doctor/comment/:toDoctorId
 * ---------------------------------------------------------
 */
export const updateEndorseComment = async (req, res) => {
  try {
    const fromDoctorId = req.userId;
    const toDoctorId = req.params.toDoctorId;
    const { comment } = req.body;

    console.log("✏️ Update endorse comment:", {
      fromDoctorId,
      toDoctorId,
      comment,
    });

    if (!fromDoctorId) {
      return res.status(401).json({ message: "User not authenticated." });
    }

    // Ищем существующую рекомендацию
    const endorsement = await DoctorEndorsement.findOne({
      fromDoctorId,
      toDoctorId,
    });

    if (!endorsement) {
      return res.status(404).json({
        message:
          "Endorsement not found — you must add endorsement first before editing comment.",
      });
    }

    // Обновляем комментарий
    endorsement.comment = comment || "";
    await endorsement.save();

    return res.json({
      success: true,
      message: "Comment updated successfully.",
      endorsement,
    });
  } catch (err) {
    console.error("❌ Update comment error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * ---------------------------------------------------------
 * 3. УДАЛИТЬ РЕКОМЕНДАЦИЮ
 * DELETE /doctor-profile/api/recommendations-from-doctor/delete/:toDoctorId
 * ---------------------------------------------------------
 */
export const removeEndorsement = async (req, res) => {
  try {
    const fromDoctorId = req.userId;
    const toDoctorId = req.params.toDoctorId;

    console.log("🗑 Removing endorsement:", { fromDoctorId, toDoctorId });

    if (!fromDoctorId) {
      return res.status(401).json({ message: "User not authenticated." });
    }

    await DoctorEndorsement.findOneAndDelete({
      fromDoctorId,
      toDoctorId,
    });

    return res.json({
      success: true,
      message: "Endorsement removed",
    });
  } catch (err) {
    console.error("❌ Remove endorsement error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * ---------------------------------------------------------
 * 4. ПОЛУЧИТЬ СПИСОК РЕКОМЕНДАЦИЙ ВРАЧА
 * GET /doctor-profile/api/recommendations-from-doctor/get/:doctorId/list
 * ---------------------------------------------------------
 */

export const getDoctorEndorsements = async (req, res) => {
  try {
    const doctorId = req.params.doctorId;

    const endorsements = await DoctorEndorsement.find({ toDoctorId: doctorId })
      .populate({
        path: "fromDoctorId",
        select:
          "firstNameEncrypted lastNameEncrypted avatar specialization _id",
        populate: {
          path: "specialization",
          model: "Specialization",
          select: "name",
        },
      })
      .populate("specializationId", "name");

    const result = endorsements.map((doc) => {
      const e = doc.toObject();
      const from = e.fromDoctorId;

      if (!from) {
        return {
          ...e,
          fromDoctorId: null,
        };
      }

      // безопасная дешифровка
      const firstName = from.firstNameEncrypted
        ? decryptField(from.firstNameEncrypted)
        : "Доктор";

      const lastName = from.lastNameEncrypted
        ? decryptField(from.lastNameEncrypted)
        : "";

      return {
        ...e,
        fromDoctorId: {
          _id: from._id,
          avatar: from.avatar || "/default-avatar-doctor.png",
          firstName: firstName || "Доктор",
          lastName: lastName || "",
          specializationName:
            from.specialization?.name ||
            e.specializationId?.name ||
            "Специализация не указана",
        },
      };
    });

    return res.json({
      success: true,
      total: result.length,
      endorsements: result,
    });
  } catch (err) {
    console.error("❌ Get endorsements error:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: err.message,
    });
  }
};
