import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { isPointInCircle } from "../utils";

const servicesRef = admin.firestore().collection("services");
const slotsRef = admin.firestore().collection("slots");

/**
 * Create a new service for a provider
 */
export const createService = functions.https.onCall(async (data, context) => {
  const {
    providerId,
    serviceName,
    description,
    pricingModel,
    basePrice,
    variations,
    imageKey,
    serviceableAreas,
    processingTime,
  } = data.data;
  // @ts-ignore
  if (!context.auth || !providerId) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "Authentication required."
    );
  }
  if (!serviceName || !pricingModel || basePrice == null) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Missing required fields."
    );
  }
  // Check for duplicate service name for this provider
  const dupSnap = await servicesRef
    .where("providerId", "==", providerId)
    .where("serviceName", "==", serviceName)
    .where("isDeleted", "==", false)
    .get();
  if (!dupSnap.empty) {
    throw new functions.https.HttpsError(
      "already-exists",
      "Service name already exists."
    );
  }
  const now = Date.now();
  const serviceData = {
    providerId,
    serviceName,
    description: description || "",
    pricingModel,
    basePrice,
    variations: variations || [],
    imageKey: imageKey || "",
    serviceableAreas: serviceableAreas || [],
    isActive: true,
    processingTime: processingTime || 0,
    isDeleted: false,
    createdAt: now,
    updatedAt: now,
  };
  const docRef = await servicesRef.add(serviceData);
  return { success: true, serviceId: docRef.id };
});

/**
 * Update a service
 */
export const updateService = functions.https.onCall(async (data, context) => {
  const { serviceId, providerId, ...updates } = data.data;
  // @ts-ignore
  if (!context.auth || !providerId || !serviceId) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "Authentication required."
    );
  }
  const docRef = servicesRef.doc(serviceId);
  const doc = await docRef.get();
  if (!doc.exists || doc.data()?.providerId !== providerId) {
    throw new functions.https.HttpsError("not-found", "Service not found.");
  }
  updates.updatedAt = Date.now();
  await docRef.update(updates);
  return { success: true };
});

/**
 * Soft delete a service
 */
export const deleteService = functions.https.onCall(async (data, context) => {
  const { serviceId, providerId } = data.data;
  // @ts-ignore
  if (!context.auth || !providerId || !serviceId) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "Authentication required."
    );
  }
  const docRef = servicesRef.doc(serviceId);
  const doc = await docRef.get();
  if (!doc.exists || doc.data()?.providerId !== providerId) {
    throw new functions.https.HttpsError("not-found", "Service not found.");
  }
  await docRef.update({
    isDeleted: true,
    updatedAt: Date.now(),
  });
  return { success: true };
});

/**
 * List all active (not deleted) services for a provider
 */
export const listServices = functions.https.onCall(async (data, context) => {
  const { providerId } = data.data;
  // @ts-ignore
  if (!context.auth || !providerId) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "Authentication required."
    );
  }
  const snap = await servicesRef
    .where("providerId", "==", providerId)
    .where("isDeleted", "==", false)
    .get();
  const services = snap.docs.map((doc) => ({
    serviceId: doc.id,
    ...doc.data(),
  }));
  return { success: true, services };
});

/**
 * Check if a user address is within any of the provider's serviceable areas
 */
export const isAddressInServiceArea = functions.https.onCall(
  async (data, context) => {
    const { providerId, location } = data.data;
    if (
      !providerId ||
      !location ||
      typeof location.latitude !== "number" ||
      typeof location.longitude !== "number"
    ) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Missing or invalid location."
      );
    }
    const areasSnap = await admin
      .firestore()
      .collection("serviceableAreas")
      .where("providerId", "==", providerId)
      .where("isActive", "==", true)
      .where("isDeleted", "==", false)
      .get();
    for (const doc of areasSnap.docs) {
      const area = doc.data();
      if (
        area.center &&
        area.radius &&
        isPointInCircle(location, area.center, area.radius)
      ) {
        return { success: true, inServiceArea: true, areaId: doc.id };
      }
    }
    return { success: true, inServiceArea: false };
  }
);

/**
 * List available slots for a serviceable area
 */
export const listSlots = functions.https.onCall(async (data, context) => {
  const { serviceableAreaId } = data.data;
  // @ts-ignore
  if (!context.auth || !serviceableAreaId) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "Authentication required."
    );
  }
  const snap = await slotsRef
    .where("serviceableAreaId", "==", serviceableAreaId)
    .get();
  const slots = snap.docs.map((doc) => ({ slotId: doc.id, ...doc.data() }));
  return { success: true, slots };
});
