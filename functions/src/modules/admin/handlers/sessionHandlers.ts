import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { validateAdminSession } from "../session";
import { auditLog } from "../../utils";

export const createSession = functions.https.onCall(
  async (data, context: any) => {
    if (!context || !context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Authentication required."
      );
    }
    const {
      sessionId,
      userId,
      isAdmin,
      deviceInfo,
      authToken,
      refreshToken,
      permissions,
      sessionDurationMinutes,
    } = data.data;
    await validateAdminSession(sessionId, context.auth.uid);
    if (!userId) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Authentication required."
      );
    }
    const now = admin.firestore.FieldValue.serverTimestamp();
    const expiresAt = admin.firestore.Timestamp.fromDate(
      new Date(Date.now() + (sessionDurationMinutes || 60) * 60000)
    );
    const sessionData = {
      userId,
      isAdmin: !!isAdmin,
      deviceInfo: deviceInfo || {},
      authToken,
      refreshToken,
      permissions: permissions || [],
      status: "active",
      lastActivity: now,
      createdAt: now,
      expiresAt,
    };
    const collection = isAdmin ? "adminSessions" : "userSessions";
    const docRef = await admin
      .firestore()
      .collection(collection)
      .add(sessionData);
    await auditLog({
      userId,
      action: "admin_session_create",
      details: { sessionId: docRef.id, deviceInfo },
      context: { ip: deviceInfo?.ipAddress },
    });
    return { success: true, sessionId: docRef.id, expiresAt };
  }
);

export const refreshSession = functions.https.onCall(
  async (data, context: any) => {
    if (!context || !context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Authentication required."
      );
    }
    const { sessionId, isAdmin, sessionDurationMinutes } = data.data;
    await validateAdminSession(sessionId, context.auth.uid);
    const expiresAt = admin.firestore.Timestamp.fromDate(
      new Date(Date.now() + (sessionDurationMinutes || 60) * 60000)
    );
    const collection = isAdmin ? "adminSessions" : "userSessions";
    await admin.firestore().collection(collection).doc(sessionId).update({
      expiresAt,
      lastActivity: admin.firestore.FieldValue.serverTimestamp(),
    });
    await auditLog({
      userId: context.auth.uid,
      action: "admin_session_refresh",
      details: { sessionId },
      context: {},
    });
    return { success: true, expiresAt };
  }
);

export const deleteSession = functions.https.onCall(
  async (data, context: any) => {
    if (!context || !context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Authentication required."
      );
    }
    const { sessionId, isAdmin } = data.data;
    await validateAdminSession(sessionId, context.auth.uid);
    const collection = isAdmin ? "adminSessions" : "userSessions";
    await admin.firestore().collection(collection).doc(sessionId).update({
      status: "revoked",
      expiresAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await auditLog({
      userId: context.auth.uid,
      action: "admin_session_delete",
      details: { sessionId },
      context: {},
    });
    return { success: true };
  }
);

export const validateSession = functions.https.onCall(
  async (data, context: any) => {
    if (!context || !context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Authentication required."
      );
    }
    const { sessionId, isAdmin } = data.data;
    await validateAdminSession(sessionId, context.auth.uid);
    const collection = isAdmin ? "adminSessions" : "userSessions";
    const doc = await admin
      .firestore()
      .collection(collection)
      .doc(sessionId)
      .get();
    const session = doc.data();
    if (!doc.exists || session?.status !== "active") {
      await auditLog({
        userId: context.auth.uid,
        action: "admin_session_invalid",
        details: { sessionId },
        context: {},
      });
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Session invalid or expired."
      );
    }
    const now = admin.firestore.Timestamp.now();
    if (session.expiresAt && now.toMillis() > session.expiresAt.toMillis()) {
      await doc.ref.update({ status: "expired" });
      await auditLog({
        userId: context.auth.uid,
        action: "admin_session_expired",
        details: { sessionId },
        context: {},
      });
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Session expired."
      );
    }
    await auditLog({
      userId: context.auth.uid,
      action: "admin_session_valid",
      details: { sessionId },
      context: {},
    });
    return { success: true, session };
  }
);
