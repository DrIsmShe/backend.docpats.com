const checkIfBlocked = (req, res, next) => {
  if (req.user && req.user.isBlocked) {
    return res.status(403).json({ message: "Ваш аккаунт заблокирован" });
  }
  next();
};

export default checkIfBlocked;
