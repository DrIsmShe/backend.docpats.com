import User from "../../../common/models/Auth/users.js";
import crypto from "crypto";

const hashData = (v) =>
  crypto.createHash("sha256").update(String(v).toLowerCase()).digest("hex");

export const checkUserType = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const emailHash = hashData(email);
    const user = await User.findOne({ emailHash });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (user.isChild === true) {
      return res.json({ type: "child", childStatus: user.childStatus });
    }

    return res.json({ type: "adult" });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};
