// compressMedicalData.js — исправленная версия
export const compressMedicalData = (data) => {
  const safeArray = (v) => (Array.isArray(v) ? v : []);

  const pickLatest = (arr, limit = 3) => {
    return safeArray(arr)
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
      .slice(0, limit);
  };

  const summarize = (arr, fields = []) => {
    return arr.map((item) => {
      const obj = {};
      fields.forEach((f) => {
        obj[f] = item?.[f] || null;
      });
      return obj;
    });
  };

  const scanFields = ["date", "report", "diagnosis"];

  return {
    birthDate: data.birthDate || null,
    gender: data.gender || null,

    chronicDiseases: safeArray(data.chronicDiseases),
    allergies: safeArray(data.allergies),
    badHabits: safeArray(data.badHabits),

    medicalHistory: safeArray(data.medicalHistoryRecords).slice(-5),

    // RADIOLOGY
    ctScans: summarize(pickLatest(data.ctScans), scanFields),
    mriScans: summarize(pickLatest(data.mriScans), scanFields),
    xrayScans: summarize(pickLatest(data.xrayScans), scanFields),
    usmScans: summarize(pickLatest(data.usmScans), scanFields),
    petScans: summarize(pickLatest(data.petScans), scanFields),
    spectScans: summarize(pickLatest(data.spectScans), scanFields),

    // FUNCTIONAL
    ekgScans: summarize(pickLatest(data.ekgScans), scanFields),
    echoEkgScans: summarize(pickLatest(data.echoEkgScans), scanFields),
    eegScans: summarize(pickLatest(data.eegScans), scanFields),
    holterScans: summarize(pickLatest(data.holterScans), scanFields),
    spirometryScans: summarize(pickLatest(data.spirometryScans), scanFields),
    doplerScans: summarize(pickLatest(data.doplerScans), scanFields),

    // ENDOSCOPY / GYN
    gastroscopyScans: summarize(pickLatest(data.gastroscopyScans), scanFields),
    capsuleEndoscopyScans: summarize(
      pickLatest(data.capsuleEndoscopyScans),
      scanFields,
    ),
    ginecologyScans: summarize(pickLatest(data.ginecologyScans), scanFields),

    // ANGIO
    angiographyScans: summarize(pickLatest(data.angiographyScans), scanFields),
    coronographyScans: summarize(
      pickLatest(data.coronographyScans),
      scanFields,
    ),

    // LAB
    labs: summarize(pickLatest(data.labTests), [
      "date",
      "testType",
      "report",
      "diagnosis",
    ]),
  };
};
