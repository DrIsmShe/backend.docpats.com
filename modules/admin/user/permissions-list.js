// GET /admin/user/permissions-list
export const getPermissionsListController = async (_req, res) => {
  try {
    return res.status(200).json({ permissions: KNOWN_PERMISSIONS });
  } catch (e) {
    return res.status(500).json({ message: "Server error" });
  }
};
