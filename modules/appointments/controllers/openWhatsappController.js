import { decryptWhatsApp } from "../../../common/utils/crypto/whatsappCrypto.js";

export const openWhatsappController = async (req, res) => {
  const appt = await Appointment.findById(req.params.id);
  if (!appt || !appt.whatsApp?.isVisibleForDoctor) {
    return res.status(403).json({ message: "Access denied" });
  }

  const phone = decryptWhatsApp(appt.whatsApp.encrypted, appt.whatsApp.iv);

  appt.whatsApp.accessLogs.push({
    userId: req.userId,
    accessedAt: new Date(),
    ip: req.ip,
  });

  await appt.save();

  res.json({
    whatsappUrl: `https://wa.me/${phone}`,
  });
};
