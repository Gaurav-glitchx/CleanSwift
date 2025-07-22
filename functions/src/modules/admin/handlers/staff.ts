import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { validateAdminSession } from "../session";

const staffRef = admin.firestore().collection("staff");

export const createStaff = functions.https.onCall(
  async (data, context: any) => {
    if (!context || !context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Authentication required."
      );
    }
    const { sessionId, providerId, name, email, phone, role, isActive } =
      data.data;
    await validateAdminSession(sessionId, context.auth.uid);
    if (!providerId || !name || !email || !phone || !role) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Missing required fields."
      );
    }
    const dupSnap = await staffRef
      .where("providerId", "==", providerId)
      .where("email", "==", email)
      .where("isDeleted", "==", false)
      .get();
    if (!dupSnap.empty) {
      throw new functions.https.HttpsError(
        "already-exists",
        "Staff email already exists for this provider."
      );
    }
    const now = Date.now();
    const staffData = {
      providerId,
      name,
      email,
      phone,
      role,
      isActive: isActive !== false,
      isDeleted: false,
      createdAt: now,
      updatedAt: now,
    };
    const docRef = await staffRef.add(staffData);
    return { success: true, staffId: docRef.id };
  }
);

export const updateStaff = functions.https.onCall(
  async (data, context: any) => {
    if (!context || !context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Authentication required."
      );
    }
    const { sessionId, staffId, providerId, ...updates } = data.data;
    await validateAdminSession(sessionId, context.auth.uid);
    if (!providerId || !staffId) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Missing required fields."
      );
    }
    const docRef = staffRef.doc(staffId);
    const doc = await docRef.get();
    if (!doc.exists || doc.data()?.providerId !== providerId) {
      throw new functions.https.HttpsError("not-found", "Staff not found.");
    }
    updates.updatedAt = Date.now();
    await docRef.update(updates);
    return { success: true };
  }
);

export const deleteStaff = functions.https.onCall(
  async (data, context: any) => {
    if (!context || !context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Authentication required."
      );
    }
    const { sessionId, staffId, providerId } = data.data;
    await validateAdminSession(sessionId, context.auth.uid);
    if (!providerId || !staffId) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Missing required fields."
      );
    }
    const docRef = staffRef.doc(staffId);
    const doc = await docRef.get();
    if (!doc.exists || doc.data()?.providerId !== providerId) {
      throw new functions.https.HttpsError("not-found", "Staff not found.");
    }
    await docRef.update({
      isDeleted: true,
      updatedAt: Date.now(),
    });
    return { success: true };
  }
);

export const listStaff = functions.https.onCall(async (data, context: any) => {
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
  const snap = await staffRef
    .where("providerId", "==", providerId)
    .where("isDeleted", "==", false)
    .get();
  const staff = snap.docs.map((doc) => ({ staffId: doc.id, ...doc.data() }));
  return { success: true, staff };
});
