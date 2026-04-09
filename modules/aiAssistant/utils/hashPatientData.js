import crypto from "crypto";

export const hashPatientData = (data) => {
  const json = JSON.stringify(data);

  return crypto.createHash("sha256").update(json).digest("hex");
};
