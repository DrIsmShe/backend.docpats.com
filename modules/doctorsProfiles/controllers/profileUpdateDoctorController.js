import ProfileDoctor from "../../../common/models/DoctorProfile/profileDoctor.js";
import { uploadFile } from "../../../common/middlewares/uploadMiddleware.js"; // ← правильно

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

    if (req.file) {
      imageUrl = await uploadFile(req.file); // ← кладёт в R2
    }

    let profile = await ProfileDoctor.findOne({ userId });

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

        // 🔥 default stored IN R2
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

      if (phoneNumber) profile.phoneNumber = phoneNumber;
      await profile.save();

      return res.status(201).json({
        message: "✅ Profile created successfully.",
        profile,
      });
    }

    const assignIfDefined = (obj, key, value) => {
      if (value !== undefined && value !== "") obj[key] = value;
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

    // phoneNumber encrypted automatically
    if (typeof phoneNumber !== "undefined") {
      profile.phoneNumber = phoneNumber === "" ? "" : phoneNumber;
    }

    await profile.save();

    return res.status(200).json({
      message: "✅ Profile updated successfully.",
      profile,
    });
  } catch (err) {
    console.error("❌ Error updating profile:", err);
    return res.status(500).json({ message: "Error updating profile." });
  }
};

export default updateProfileControllerDoctor;
