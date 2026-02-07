import crypto from "crypto";

export const hashEmail = (email) => {
  return crypto.createHash("sha256").update(email.toLowerCase()).digest("hex");
};
