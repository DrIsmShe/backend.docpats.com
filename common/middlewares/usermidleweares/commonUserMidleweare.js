// middleware/authMiddleware.js
const commonUserAuthSessionMiddleware = (req, res, next) => {
  if (req.session.userId) {
    // Доступ к данным пользователя
    req.user = {
      userId: req.session.userId,
      username: req.session.username,
      email: req.session.email,
      firstName: req.session.firstName,
      lastName: req.session.lastName,
    };
    console.log("User data:", req.user);
    next(); // Пользователь аутентифицирован
  } else {
    res.status(401).json({ message: "Unauthorized" });
  }
};

export default commonUserAuthSessionMiddleware;
