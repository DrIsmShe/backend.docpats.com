const checkIfBlocked = (req, res, next) => {
  if (req.user && req.user.isBlocked) {
    return res.status(403).json({ message: req.t("app.account.blocked") });
  }
  next();
};

export default checkIfBlocked;
