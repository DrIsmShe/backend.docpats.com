export const SUBSCRIPTION_PRESETS = {
  doctor_free: {
    maxPatients: 10,
    aiAccess: false,
    prioritySupport: false,
  },
  doctor_pro: {
    maxPatients: Infinity,
    aiAccess: false,
    prioritySupport: true,
  },
  patient_free: {
    familyMembers: 0,
  },
  patient_plus: {
    familyMembers: 0,
    aiAccess: true,
  },
  patient_family: {
    familyMembers: 5,
  },
};
