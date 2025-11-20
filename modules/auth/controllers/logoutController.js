import User from "../../../common/models/Auth/users.js";

const logoutController = async (req, res) => {
  try {
    const userId = req.session.userId;
    if (!userId) {
      return res.status(401).json({ message: "User is not authorized" });
    }

    // 🔄 **Update user status to "offline"**
    await User.findByIdAndUpdate(userId, { status: "offline" });

    // **Delete session**
    req.session.destroy((err) => {
      if (err) {
        console.error("❌ Logout error:", err);
        return res.status(500).json({ message: "Error logging out" });
      }

      res.clearCookie("connect.sid"); // Delete session cookie
      console.log(`✅ User with ID ${userId} has logged out (Offline)`);
      return res
        .status(200)
        .json({ message: "You have successfully logged out." });
    });
  } catch (error) {
    console.error("❌ Logout error:", error);
    return res.status(500).json({ message: "Server error logging out" });
  }
};

export default logoutController;
