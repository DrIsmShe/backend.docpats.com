// modules/clinic/clinic-staff/email/sendInvitationEmail.js
//
// Specialized email sender for clinic-staff invitations.
//
// Why a separate function instead of using common/services/emailService.js?
// - The shared sendEmail wraps message text in <p>${message}</p>, which
//   breaks rich HTML (buttons, styles, links).
// - Invitations need branded HTML with a CTA button and clinic name.
// - This function bypasses the wrap and sends raw HTML to Brevo.
//
// In tests, this module is mocked via vi.mock() so no real emails go out.

import axios from "axios";
import logger from "../../../../common/logger.js";

const log = logger.child({ module: "clinic-staff/email" });

/**
 * Send a rich HTML email through Brevo.
 *
 * @param {object} options
 * @param {string|string[]} options.to       Recipient email(s)
 * @param {string} options.subject           Email subject
 * @param {string} options.htmlContent       Raw HTML body
 * @param {string} [options.textContent]     Plain text fallback
 * @returns {Promise<boolean>}                true on success, false on failure
 */
export async function sendRichEmail({ to, subject, htmlContent, textContent }) {
  const recipients = Array.isArray(to) ? to : [to];
  const senderEmail = process.env.EMAIL_FROM || "no-reply@docpats.com";
  const senderName = process.env.EMAIL_FROM_NAME || "DOCPATS";
  const apiKey = process.env.BREVO_API_KEY;

  if (!apiKey) {
    log.error({ recipients }, "BREVO_API_KEY is missing — email not sent");
    return false;
  }

  try {
    const response = await axios.post(
      "https://api.brevo.com/v3/smtp/email",
      {
        sender: { email: senderEmail, name: senderName },
        to: recipients.map((email) => ({ email })),
        subject,
        htmlContent,
        textContent: textContent || stripHtml(htmlContent),
      },
      {
        headers: {
          "Content-Type": "application/json",
          "api-key": apiKey,
        },
        timeout: 10_000,
      },
    );

    log.info(
      { recipients, subject, brevoMessageId: response.data?.messageId },
      "Email sent via Brevo",
    );
    return true;
  } catch (error) {
    log.error(
      {
        recipients,
        subject,
        err: error.response?.data || error.message,
      },
      "Brevo email send failed",
    );
    return false;
  }
}

/**
 * Strip HTML tags for plain-text fallback.
 */
function stripHtml(html) {
  return String(html)
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
