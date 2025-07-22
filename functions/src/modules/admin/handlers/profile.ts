import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { validateAdminSession } from "../session";

export const updateAdminProfile = functions.https.onCall(
  async (data, context: any) => {
    if (!context || !context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Authentication required."
      );
    }
    const { sessionId, adminId, ...updates } = data.data;
    await validateAdminSession(sessionId, context.auth.uid);
    if (!adminId) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Authentication required."
      );
    }
    updates.updatedAt = Date.now();
    await admin
      .firestore()
      .collection("providers")
      .doc(adminId)
      .update(updates);
    return { success: true };
  }
);

export const updateProviderStatus = functions.https.onCall(
  async (data, context: any) => {
    if (!context || !context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Authentication required."
      );
    }
    const { sessionId, providerId, isActive } = data.data;
    await validateAdminSession(sessionId, context.auth.uid);
    if (!providerId) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Authentication required."
      );
    }
    await admin.firestore().collection("providers").doc(providerId).update({
      isActive,
      goLiveAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { success: true };
  }
);
