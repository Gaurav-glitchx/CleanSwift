import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { validateAdminSession } from "../session";

const serviceableAreasRef = admin.firestore().collection("serviceableAreas");

export const createServiceableArea = functions.https.onCall(
  async (data, context: any) => {
    if (!context || !context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Authentication required."
      );
    }
    const { sessionId, providerId, name, center, radius, workingHoursId } =
      data.data;
    await validateAdminSession(sessionId, context.auth.uid);
    if (!providerId || !name || !center || !radius) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Missing required fields."
      );
    }
    const dupSnap = await serviceableAreasRef
      .where("providerId", "==", providerId)
      .where("name", "==", name)
      .where("isDeleted", "==", false)
      .get();
    if (!dupSnap.empty) {
      throw new functions.https.HttpsError(
        "already-exists",
        "Area name already exists for this provider."
      );
    }
    const now = Date.now();
    const areaData = {
      providerId,
      name,
      center,
      radius,
      workingHoursId: workingHoursId || null,
      isActive: true,
      isDeleted: false,
      createdAt: now,
      updatedAt: now,
    };
    const docRef = await serviceableAreasRef.add(areaData);
    return { success: true, areaId: docRef.id };
  }
);

export const updateServiceableArea = functions.https.onCall(
  async (data, context: any) => {
    if (!context || !context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Authentication required."
      );
    }
    const { sessionId, areaId, providerId, ...updates } = data.data;
    await validateAdminSession(sessionId, context.auth.uid);
    if (!providerId || !areaId) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Missing required fields."
      );
    }
    const docRef = serviceableAreasRef.doc(areaId);
    const doc = await docRef.get();
    if (!doc.exists || doc.data()?.providerId !== providerId) {
      throw new functions.https.HttpsError(
        "not-found",
        "Serviceable area not found."
      );
    }
    updates.updatedAt = Date.now();
    await docRef.update(updates);
    return { success: true };
  }
);

export const deleteServiceableArea = functions.https.onCall(
  async (data, context: any) => {
    if (!context || !context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Authentication required."
      );
    }
    const { sessionId, areaId, providerId } = data.data;
    await validateAdminSession(sessionId, context.auth.uid);
    if (!providerId || !areaId) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Missing required fields."
      );
    }
    const docRef = serviceableAreasRef.doc(areaId);
    const doc = await docRef.get();
    if (!doc.exists || doc.data()?.providerId !== providerId) {
      throw new functions.https.HttpsError(
        "not-found",
        "Serviceable area not found."
      );
    }
    await docRef.update({
      isDeleted: true,
      updatedAt: Date.now(),
    });
    return { success: true };
  }
);

export const listServiceableAreas = functions.https.onCall(
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
    const snap = await serviceableAreasRef
      .where("providerId", "==", providerId)
      .where("isDeleted", "==", false)
      .get();
    const areas = snap.docs.map((doc) => ({ areaId: doc.id, ...doc.data() }));
    return { success: true, areas };
  }
);
