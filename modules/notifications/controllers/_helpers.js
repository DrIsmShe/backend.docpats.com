// server/modules/notifications/controllers/_helpers.js
import NewPatientPolyclinic from "../../../common/models/newPatientPolyclinic.js";

export const getPatientRecipientIds = async (userId) => {
  const profile = await NewPatientPolyclinic.findOne({ linkedUserId: userId })
    .select("_id")
    .lean();
  return profile ? [userId, profile._id] : [userId];
};
