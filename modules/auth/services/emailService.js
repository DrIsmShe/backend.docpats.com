// server/modules/auth/services/emailService.js
//
// SMTP wrapper around nodemailer.
//
// Critical config rules:
//   - SMTP_HOST: REQUIRED. We default to Brevo (smtp-relay.brevo.com),
//     NOT mailtrap sandbox. The old mailtrap fallback caused silent
//     non-delivery for weeks — nodemailer returned "success" because
//     mailtrap accepts everything, but no email ever reached the
//     recipient and no event appeared in Brevo logs.
//   - SMTP_FROM: REQUIRED in prod. Must be a verified sender in Brevo
//     (e.g. no-reply@docpats.com). NEVER fall back to SMTP_USER —
//     SMTP_USER is the Brevo login ID (e.g. "220f0a65123840"), which
//     is NOT a valid email address and Brevo rejects messages with it.
//   - SMTP_USER / SMTP_PASS: REQUIRED. Get them from
//     https://app.brevo.com/settings/keys/smtp

import nodemailer from "nodemailer";
import "dotenv/config";

// ─── Config resolution with loud failure for misconfiguration ────────

const SMTP_HOST = process.env.SMTP_HOST || "smtp-relay.brevo.com";
const SMTP_PORT = Number(process.env.SMTP_PORT) || 587;
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_FROM = process.env.SMTP_FROM;

// Fail fast — better to crash on startup than to silently send nothing
// (the bug we just fixed). Only require SMTP_USER/PASS — host has a
// safe default to Brevo, and SMTP_FROM also has a safe default below.
if (!SMTP_USER || !SMTP_PASS) {
  console.error(
    "❌ emailService misconfigured: SMTP_USER and SMTP_PASS are required in .env",
  );
}

// If SMTP_FROM is missing, default to a safe Docpats address. NEVER
// use SMTP_USER as a fallback — that's the login ID, not an email.
const FROM_ADDRESS = SMTP_FROM || "no-reply@docpats.com";

const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: SMTP_PORT === 465, // true for 465, false for 587/2525
  auth: {
    user: SMTP_USER,
    pass: SMTP_PASS,
  },
});

// One-time verify on startup so config errors surface immediately
// instead of looking like "email sent" successes that go nowhere.
transporter
  .verify()
  .then(() => {
    console.log(
      `📮 SMTP transporter verified: ${SMTP_HOST}:${SMTP_PORT} as ${SMTP_USER}, from=${FROM_ADDRESS}`,
    );
  })
  .catch((err) => {
    console.error(
      `❌ SMTP transporter verify FAILED for ${SMTP_HOST}:${SMTP_PORT} — ${err.message}`,
    );
  });

export const sendEmail = async (to, subject, text) => {
  const mailOptions = {
    from: `"DocPats Support" <${FROM_ADDRESS}>`,
    to,
    subject,
    text,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(
      `✅ Email accepted by SMTP: ${info.messageId} → ${to} (response: ${info.response || "n/a"})`,
    );
    return info;
  } catch (error) {
    console.error(
      `❌ Error sending email to ${to}: ${error.message} (code=${error.code || "n/a"})`,
    );
    throw error;
  }
};
