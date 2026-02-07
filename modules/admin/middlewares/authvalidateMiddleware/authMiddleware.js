// middleware/authMiddleware.js
const authMiddleware = (req, res, next) => {
  if (req.session.userId) {
    console.log("User data:", req.session);
    req.user = {
      authenticated: true,
      userId: req.session.userId,
      username: req.session.username,
      useremail: req.session.email,
      userfirstName: req.session.firstName,
      userlastName: req.session.lastName,
    }; // Пользователь авторизован

    next(); // Пользователь аутентифицирован
  } else {
    return res.status(401).json({ authenticated: false }); // Пользователь не авторизован
  }
};

export default authMiddleware;
