import crypto from "crypto";
import dotenv from "dotenv";
import argon2 from "argon2";
import User from "../../../common/models/Auth/users.js";

dotenv.config();

const SECRET_KEY = process.env.ENCRYPTION_KEY?.padEnd(32, "0");
if (!SECRET_KEY || SECRET_KEY.length !== 32) {
  throw new Error("❌ Error: ENCRYPTION_KEY not found or invalid!");
}

const changePasswordProfileController = async (req, res) => {
  try {
    const { currentPassword, newPassword, renewPassword } = req.body;

    if (!req.session.userId) {
      console.log("Error: User not authenticated.");
      return res.status(403).json({ message: "Please sign in." });
    }

    console.log("ChangePasswordProfileController called");
    console.log("Request data:", req.body);

    if (!currentPassword || !newPassword || !renewPassword) {
      return res.status(400).json({ message: "All fields are required." });
    }

    if (newPassword !== renewPassword) {
      return res
        .status(400)
        .json({ message: "New password and confirmation do not match." });
    }

    if (newPassword.length < 8) {
      return res
        .status(400)
        .json({ message: "Password must be at least 8 characters long." });
    }

    const existingUser = await User.findById(req.session.userId);
    if (!existingUser) {
      return res.status(404).json({ message: "User not found." });
    }

    const isCurrentPasswordValid = await argon2.verify(
      existingUser.password,
      currentPassword
    );
    if (!isCurrentPasswordValid) {
      return res
        .status(400)
        .json({ message: "Current password is incorrect." });
    }

    if (await argon2.verify(existingUser.password, newPassword)) {
      return res
        .status(400)
        .json({ message: "New password must not match current." });
    }

    const hashedPassword = await argon2.hash(newPassword, {
      timeCost: 3,
      memoryCost: 2 ** 17,
      parallelism: 1,
      type: argon2.argon2id,
    });

    existingUser.password = hashedPassword;
    await existingUser.save();
    return res.status(200).json({ message: "Password successfully changed." });
  } catch (error) {
    console.error("Error changing password: ", error);
    return res.status(500).json({
      message: "An error occurred while changing the password.",
      error: error.message,
    });
  }
};

export default changePasswordProfileController;
