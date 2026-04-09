import User from "../../../common/models/Auth/users.js";

const blockUserController = async (req, res) => {
  const { id } = req.params; // User ID from URL
  const { isBlocked } = req.body; // Block status

  try {
    const user = await User.findById(id);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    user.isBlocked = isBlocked; // Setting the block status
    await user.save();

    res.status(200).json({
      message: `User ${isBlocked ? "blocked" : "unblocked"}`,
      user,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error });
  }
};

export default blockUserController;
