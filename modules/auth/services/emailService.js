import nodemailer from "nodemailer";
import "dotenv/config"; // Загружаем переменные окружения

// Конфигурация транспондера
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "sandbox.smtp.mailtrap.io",
  port: process.env.SMTP_PORT || 587, // Используйте переменную окружения, если нужно
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export const sendEmail = async (to, subject, text) => {
  const mailOptions = {
    from: `"DocPats Support" <${process.env.SMTP_USER}>`, // 💡 Добавлен красивый заголовок
    to,
    subject,
    text,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ Email sent successfully: ${info.messageId}`);
  } catch (error) {
    console.error("❌ Error sending email:", error.message);
    throw error;
  }
};
