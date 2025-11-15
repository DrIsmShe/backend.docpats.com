// import nodemailer from "nodemailer";

// const transporter = nodemailer.createTransport({
//   host: process.env.SMTP_HOST,
//   port: 587, // или 465 для SSL
//   secure: false, // если используешь 465 — поставь true
//   auth: {
//     user: process.env.SMTP_USER,
//     pass: process.env.SMTP_PASS,
//   },
//   tls: {
//     rejectUnauthorized: false, // 🚨 добавь ЭТО — отключает проверку "self-signed"
//   },
// });

// export const sendEmail = async (to, subject, text) => {
//   const mailOptions = {
//     from: process.env.SMTP_USER,
//     to,
//     subject,
//     text,
//   };

//   try {
//     await transporter.sendMail(mailOptions);
//     console.log("📩 Email sent successfully to", to);
//   } catch (error) {
//     console.error("❌ Error sending email:", error);
//     throw error;
//   }
// };

// services/email/sendEmail.js (пример пути)
import axios from "axios";

export const sendEmail = async (to, subject, text) => {
  try {
    console.log("📨 Sending email to:", to);

    const senderEmail = process.env.EMAIL_FROM || "no-reply@docpats.com";
    const senderName = process.env.EMAIL_FROM_NAME || "DOCPATS";

    const apiKey = process.env.BREVO_API_KEY;
    if (!apiKey) {
      console.error("❌ BREVO_API_KEY is missing in environment variables");
      return false; // НЕ роняем регистрацию
    }

    const response = await axios.post(
      "https://api.brevo.com/v3/smtp/email",
      {
        sender: { email: senderEmail, name: senderName },
        to: [{ email: to }],
        subject,
        textContent: text,
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
    console.error("❌ Brevo email error:", error.response?.data || error);
    return false; // Не ломаем регистрацию
  }
};
