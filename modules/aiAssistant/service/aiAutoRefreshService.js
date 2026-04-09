import AISummaryCache from "../model/AISummaryCache.js";

export const invalidatePatientAISummary = async (patientId) => {
  try {
    await AISummaryCache.deleteMany({
      patientId: patientId,
    });

    console.log("AI cache invalidated for patient:", patientId);
  } catch (error) {
    console.error("AI cache invalidation error:", error);
  }
};
