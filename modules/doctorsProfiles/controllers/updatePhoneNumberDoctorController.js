// Серверный контроллер для изменения телефона доктора
import Doctor from "../../../common/models/Auth/users.js";
import { sendSMS } from "../../../common/services/smsService.js";
import { sendEmail } from "../../../common/services/emailService.js";
import { decrypt, hashData } from "../../../common/utils/cryptoUtils.js";

const otpStorage = new Map();
const generateOtp = () =>
  Math.floor(100000 + Math.random() * 900000).toString();

const updatePhoneNumberDoctorController = async (req, res) => {
  try {
    const { email, newPhoneNumber, otpCode } = req.body;

    if (!email || !newPhoneNumber) {
      return res
        .status(400)
        .json({ message: "Email and new number are required." });
    }

    const emailHash = hashData(email);
    const doctor = await Doctor.findOne({ emailHash });

    if (!doctor) {
      return res.status(404).json({ message: "Doctor not found." });
    }

    const decryptedEmail = decrypt(doctor.emailEncrypted);
    if (!decryptedEmail) {
      return res.status(500).json({ message: "Error decrypting email." });
    }

    if (otpCode) {
      const storedOtp = otpStorage.get(newPhoneNumber);

      if (storedOtp && storedOtp === otpCode) {
        doctor.phoneEncrypted = newPhoneNumber;
        doctor.phoneHash = hashData(newPhoneNumber);
        await doctor.save();

        otpStorage.delete(newPhoneNumber);

        console.log(
          `✅ Phone number successfully updated for ${decryptedEmail}: ${newPhoneNumber}`
        );

        return res
          .status(200)
          .json({ message: "Phone number successfully updated." });
      }

      return res.status(400).json({ message: "Invalid verification code." });
    }

    const otp = generateOtp();
    otpStorage.set(newPhoneNumber, otp);

    setTimeout(() => otpStorage.delete(newPhoneNumber), 300000);

    await sendSMS(newPhoneNumber, `Your verification code: ${otp}`);
    await sendEmail(
      decrypt(doctor.emailEncrypted),
      "Confirmation of phone number change",
      `Your verification code: ${otp}`
    );

    return res.status(200).json({
      message:
        "The verification code has been sent to your new number and email.",
      otpSent: true,
      otpExpiresAt: Date.now() + 300000,
    });
  } catch (error) {
    console.error("❌ Error updating phone number:", error);
    return res.status(500).json({ message: "Server error." });
  }
};

export default updatePhoneNumberDoctorController;
