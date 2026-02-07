const checkIfBlocked = (req, res, next) => {
  if (req.user && req.user.isBlocked) {
    return res.status(403).json({ message: "Your account has been blocked" });
  }
  next();
};

export default checkIfBlocked;
