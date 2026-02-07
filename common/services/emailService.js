import axios from "axios";

export const sendEmail = async (emails, subject, message) => {
  try {
    // Преобразуем emails в массив
    const recipients = Array.isArray(emails) ? emails : [emails];

    console.log("📨 Sending email to:", recipients);

    const senderEmail = process.env.EMAIL_FROM || "no-reply@docpats.com";
    const senderName = process.env.EMAIL_FROM_NAME || "DOCPATS";

    const apiKey = process.env.BREVO_API_KEY;
    if (!apiKey) {
      console.error("❌ BREVO_API_KEY is missing");
      return false;
    }

    const response = await axios.post(
      "https://api.brevo.com/v3/smtp/email",
      {
        sender: { email: senderEmail, name: senderName },
        to: recipients.map((email) => ({ email })), // МАССИВ email
        subject,
        textContent: message,
        htmlContent: `<p>${message}</p>`, // HTML для лучшей доставки
      },
      {
        headers: {
          "Content-Type": "application/json",
          "api-key": apiKey,
        },
      }
    );

    console.log("📩 Brevo email sent:", response.data);
    return true;
  } catch (error) {
    console.error("❌ FULL Brevo error:", error.response?.data || error);
    return false;
  }
};
