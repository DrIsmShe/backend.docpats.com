import {
  mintRoomToken,
  isJitsiConfigured,
} from "../../../common/video/jitsiToken.service.js";
import DialogParticipant from "../dialogs/dialogParticipant.model.js";
import {
  ValidationError,
  ForbiddenError,
} from "../../../common/utils/errors.js";

const MODERATOR_DIALOG_ROLES = new Set(["doctor", "admin"]);

async function resolveDialogRoom(userId, dialogId) {
  if (!dialogId) {
    throw new ValidationError("id is required for kind=dialog", {
      field: "id",
    });
  }
  const participant = await DialogParticipant.findOne({
    dialogId,
    userId,
    isRemoved: false,
  })
    .select("roleInDialog")
    .lean();
  if (!participant) {
    throw new ForbiddenError("You are not a participant of this dialog");
  }
  return {
    room: `dialog-${String(dialogId)}`,
    moderator: MODERATOR_DIALOG_ROLES.has(participant.roleInDialog),
  };
}

export async function issueVideoTokenController(req, res, next) {
  try {
    if (!isJitsiConfigured()) {
      return res
        .status(503)
        .json({ message: "Video service is not configured" });
    }
    const userId = req.user?._id;
    if (!userId) {
      throw new ForbiddenError("Authentication required");
    }
    const { kind, id } = req.body || {};
    let resolved;
    if (kind === "dialog") {
      resolved = await resolveDialogRoom(userId, id);
    } else {
      throw new ValidationError('Unsupported room kind (expected "dialog")', {
        field: "kind",
        received: kind,
      });
    }
    const displayName =
      [req.user?.firstName, req.user?.lastName].filter(Boolean).join(" ") ||
      req.user?.name ||
      null;
    const result = mintRoomToken({
      room: resolved.room,
      userId: String(userId),
      displayName,
      email: req.user?.email || null,
      moderator: resolved.moderator,
    });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export default { issueVideoTokenController };
