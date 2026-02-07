// server/bootstrap/validateEnv.js
function must(name, pred = (v) => !!v) {
  const val = process.env[name];
  if (!pred(val)) {
    throw new Error(`Missing or invalid env: ${name}`);
  }
  return val;
}

export function validateEnv() {
  must("NODE_ENV");
  must("PORT", (v) => /^\d+$/.test(v));
  must("MONGO_URL");
  must("MONGODB_DB");
  must("ENCRYPTION_KEY", (v) => typeof v === "string" && v.length > 0);

  // phone crypto
  if (process.env.DETERMINISTIC_PHONE_ENCRYPT === "1") {
    must("PHONE_IV", (v) => typeof v === "string" && v.length === 16);
  }

  // email
  must("SMTP_HOST");
  must("SMTP_PORT");
  must("SMTP_USER");
  must("SMTP_PASS");

  // ai
  must("OPENAI_API_KEY");
}
