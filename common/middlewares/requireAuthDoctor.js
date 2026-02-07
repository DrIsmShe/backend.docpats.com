export const requireAuthDoctor = (req, res, next) => {
  console.log("🟡 REQUIRE AUTH DOCTOR:", req.userId, req.session.role);

  if (!req.session.userId) {
    return res.status(401).json({ message: "Please log in." });
  }

  if (req.user?.role !== "doctor") {
    return res.status(403).json({ message: "Only doctors can endorse." });
  }

  next();
};
