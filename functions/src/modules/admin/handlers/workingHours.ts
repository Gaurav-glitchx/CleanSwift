import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { validateAdminSession } from "../session";

const workingHoursRef = admin.firestore().collection("workingHours");

export const createWorkingHours = functions.https.onCall(
  async (data, context: any) => {
    if (!context || !context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Authentication required."
      );
    }
    const { sessionId, providerId, ...hours } = data.data;
    await validateAdminSession(sessionId, context.auth.uid);
    if (!providerId) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Provider ID required."
      );
    }
    const dupSnap = await workingHoursRef
      .where("providerId", "==", providerId)
      .where("isDeleted", "==", false)
      .get();
    if (!dupSnap.empty) {
      throw new functions.https.HttpsError(
        "already-exists",
        "Working hours already exist for this provider."
      );
    }
    const now = Date.now();
    const workingHoursData = {
      providerId,
      ...hours,
      isDeleted: false,
      createdAt: now,
      updatedAt: now,
    };
    const docRef = await workingHoursRef.add(workingHoursData);
    return { success: true, hoursId: docRef.id };
  }
);

export const updateWorkingHours = functions.https.onCall(
  async (data, context: any) => {
    if (!context || !context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Authentication required."
      );
    }
    const { sessionId, hoursId, providerId, ...updates } = data.data;
    await validateAdminSession(sessionId, context.auth.uid);
    if (!providerId || !hoursId) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Missing required fields."
      );
    }
    const docRef = workingHoursRef.doc(hoursId);
    const doc = await docRef.get();
    if (!doc.exists || doc.data()?.providerId !== providerId) {
      throw new functions.https.HttpsError(
        "not-found",
        "Working hours not found."
      );
    }
    updates.updatedAt = Date.now();
    await docRef.update(updates);
    return { success: true };
  }
);

export const deleteWorkingHours = functions.https.onCall(
  async (data, context: any) => {
    if (!context || !context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Authentication required."
      );
    }
    const { sessionId, hoursId, providerId } = data.data;
    await validateAdminSession(sessionId, context.auth.uid);
    if (!providerId || !hoursId) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Missing required fields."
      );
    }
    const docRef = workingHoursRef.doc(hoursId);
    const doc = await docRef.get();
    if (!doc.exists || doc.data()?.providerId !== providerId) {
      throw new functions.https.HttpsError(
        "not-found",
        "Working hours not found."
      );
    }
    await docRef.update({
      isDeleted: true,
      updatedAt: Date.now(),
    });
    return { success: true };
  }
);

export const listWorkingHours = functions.https.onCall(
  async (data, context: any) => {
    if (!context || !context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Authentication required."
      );
    }
    const { sessionId, providerId } = data.data;
    await validateAdminSession(sessionId, context.auth.uid);
    if (!providerId) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Authentication required."
      );
    }
    const snap = await workingHoursRef
      .where("providerId", "==", providerId)
      .where("isDeleted", "==", false)
      .get();
    const workingHours = snap.docs.map((doc) => ({
      hoursId: doc.id,
      ...doc.data(),
    }));
    return { success: true, workingHours };
  }
);
