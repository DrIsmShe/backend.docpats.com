import ProfileDoctor from "../../../common/models/DoctorProfile/profileDoctor.js";
import { uploadFile } from "../../../common/middlewares/uploadMiddleware.js";

const updateProfileControllerDoctor = async (req, res) => {
  try {
    const userId = req.session?.userId;

    if (!userId) {
      return res.status(403).json({ message: "Please sign in." });
    }

    const {
      company,
      speciality,
      address,
      phoneNumber,
      clinic,
      about,
      country,
      twitter,
      facebook,
      instagram,
      linkedin,
      educationInstitution,
      educationYears,
      specializationInstitution,
      specializationYears,
    } = req.body || {};

    const parseRange = (rangeStr) => {
      if (!rangeStr) return { start: null, end: null };
      const [start, end] = rangeStr.split("-").map((n) => Number(n.trim()));
      return { start: start || null, end: end || null };
    };

    const { start: educationStartYear, end: educationEndYear } =
      parseRange(educationYears);

    const { start: specializationStartYear, end: specializationEndYear } =
      parseRange(specializationYears);

    // 🔥 Upload new profile image to R2
    let imageUrl = null;
    if (req.file && req.file.buffer && req.file.mimetype) {
      imageUrl = await uploadFile(req.file);
    }

    let profile = await ProfileDoctor.findOne({ userId });

    /* =========================================================
       CREATE PROFILE
    ========================================================= */

    if (!profile) {
      profile = new ProfileDoctor({
        userId,
        company,
        speciality,
        address,
        clinic,
        about,
        country,
        twitter,
        facebook,
        instagram,
        linkedin,
        profileImage:
          imageUrl ||
          `${process.env.R2_PUBLIC_URL}/uploads/default/doctor_consultation_02.jpg`,
        educationInstitution,
        educationStartYear,
        educationEndYear,
        specializationInstitution,
        specializationStartYear,
        specializationEndYear,
      });

      if (phoneNumber) {
        const existing = await ProfileDoctor.findByPhone(phoneNumber);

        if (existing) {
          return res.status(400).json({
            message: "❌ This phone number is already used by another doctor.",
          });
        }

        profile.phoneNumber = phoneNumber; // виртуал сам шифрует + хеширует
      }
      if (!profile.clinic || profile.clinic.trim() === "") {
        return res.status(400).json({
          message: "❌ Clinic is required",
        });
      }
      await profile.save();

      return res.status(201).json({
        message: "✅ Profile created successfully.",
        profile,
      });
    }

    /* =========================================================
       UPDATE PROFILE
    ========================================================= */

    const assignIfDefined = (obj, key, value) => {
      if (value !== undefined && value !== "") {
        obj[key] = value;
      }
    };

    assignIfDefined(profile, "company", company);
    assignIfDefined(profile, "speciality", speciality);
    assignIfDefined(profile, "address", address);
    assignIfDefined(profile, "clinic", clinic);
    assignIfDefined(profile, "about", about);
    assignIfDefined(profile, "country", country);
    assignIfDefined(profile, "twitter", twitter);
    assignIfDefined(profile, "facebook", facebook);
    assignIfDefined(profile, "instagram", instagram);
    assignIfDefined(profile, "linkedin", linkedin);
    assignIfDefined(profile, "educationInstitution", educationInstitution);

    if (educationStartYear) profile.educationStartYear = educationStartYear;
    if (educationEndYear) profile.educationEndYear = educationEndYear;

    if (specializationInstitution)
      profile.specializationInstitution = specializationInstitution;

    if (specializationStartYear)
      profile.specializationStartYear = specializationStartYear;

    if (specializationEndYear)
      profile.specializationEndYear = specializationEndYear;

    // 🔥 Update profile image
    if (imageUrl) {
      profile.profileImage = imageUrl;
    }

    /* =========================================================
       PHONE UPDATE (SAFE)
    ========================================================= */

    if (typeof phoneNumber !== "undefined") {
      const isValidPhone =
        typeof phoneNumber === "string" && /^\+\d{8,15}$/.test(phoneNumber);

      if (!phoneNumber || phoneNumber.trim() === "") {
        profile.phoneNumber = null;
      } else if (!isValidPhone) {
        return res.status(400).json({
          message: "❌ Invalid phone number format. Use +123456789",
        });
      } else {
        const existing = await ProfileDoctor.findByPhone(phoneNumber);

        if (existing && existing._id.toString() !== profile._id.toString()) {
          return res.status(400).json({
            message: "❌ This phone number is already used by another doctor.",
          });
        }

        profile.phoneNumber = phoneNumber;
      }
    }

    await profile.save();

    return res.status(200).json({
      message: "✅ Profile updated successfully.",
      profile,
    });
  } catch (err) {
    console.error("❌ Error updating profile:", err);

    // 🔥 защита от race condition
    if (err.code === 11000 && err.keyPattern?.phoneHash) {
      return res.status(400).json({
        message: "❌ This phone number is already used by another doctor.",
      });
    }

    return res.status(500).json({ message: "Error updating profile." });
  }
};

export default updateProfileControllerDoctor;
