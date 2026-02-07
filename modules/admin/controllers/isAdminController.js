import User from "../../models/users.js";

const isAdminController = (req, res, next) => {
  if (req.session.userId) {
    // Ищем пользователя в базе данных
    User.findById(req.session.userId)
      .then((user) => {
        if (user && user.role === "admin") {
          next(); // Если роль - админ, пропускаем
        } else {
          res.status(403).json({ message: "Access denied" }); // If not admin
        }
      })
      .catch((err) =>
        res.status(500).json({ message: "Server error", error: err })
      );
  } else {
    res.status(401).json({ message: "Unauthorized access" });
  }
};
export default isAdminController;
