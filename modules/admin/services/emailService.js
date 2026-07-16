import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: 25,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export const sendEmail = async (to, subject, text) => {
  const mailOptions = {
    from: process.env.SMTP_USER,
    to,
    subject,
    text,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log("Email sent successfully");
  } catch (error) {
    console.error("Error sending email:", error);
    throw error;
  }
};

// Отправка письма с вложениями (напр. PDF-отчёт аналитики).
// attachments — массив в формате nodemailer: { filename, content(Buffer), contentType }.
export const sendEmailWithAttachment = async (
  to,
  subject,
  text,
  attachments = [],
) => {
  const mailOptions = {
    from: process.env.SMTP_USER,
    to,
    subject,
    text,
    attachments,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log("Email with attachment sent successfully");
  } catch (error) {
    console.error("Error sending email with attachment:", error);
    throw error;
  }
};
