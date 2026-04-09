export function requireFeature(feature) {
  return (req, res, next) => {
    if (!req.user?.features?.[feature]) {
      return res
        .status(403)
        .json({ message: `Feature '${feature}' not available` });
    }
    next();
  };
}
