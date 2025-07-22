import * as functions from "firebase-functions";
import * as admin from "firebase-admin";

const couponsRef = admin.firestore().collection("coupons");

/**
 * Create a coupon
 */
export const createCoupon = functions.https.onCall(async (data, context) => {
  const {
    couponName,
    couponCode,
    maxDiscount,
    minValue,
    validFrom,
    validTill,
  } = data.data;
  // @ts-ignore
  if (
    // @ts-ignore
    !context.auth ||
    !couponName ||
    !couponCode ||
    !maxDiscount ||
    !minValue ||
    !validFrom ||
    !validTill
  ) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Missing required fields."
    );
  }
  // Prevent duplicate coupon code
  const dupSnap = await couponsRef
    .where("couponCode", "==", couponCode)
    .where("isDeleted", "==", false)
    .get();
  if (!dupSnap.empty) {
    throw new functions.https.HttpsError(
      "already-exists",
      "Coupon code already exists."
    );
  }
  const now = Date.now();
  const couponData = {
    couponName,
    couponCode,
    maxDiscount,
    minValue,
    validFrom: new Date(validFrom),
    validTill: new Date(validTill),
    isActive: true,
    isDeleted: false,
    createdAt: now,
    updatedAt: now,
  };
  const docRef = await couponsRef.add(couponData);
  return { success: true, couponId: docRef.id };
});

/**
 * Update a coupon
 */
export const updateCoupon = functions.https.onCall(async (data, context) => {
  const { couponId, ...updates } = data.data;
  // @ts-ignore
  if (!context.auth || !couponId) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Missing required fields."
    );
  }
  updates.updatedAt = Date.now();
  await couponsRef.doc(couponId).update(updates);
  return { success: true };
});

/**
 * Soft delete a coupon
 */
export const deleteCoupon = functions.https.onCall(async (data, context) => {
  const { couponId } = data.data;
  // @ts-ignore
  if (!context.auth || !couponId) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Missing required fields."
    );
  }
  await couponsRef.doc(couponId).update({
    isDeleted: true,
    updatedAt: Date.now(),
  });
  return { success: true };
});

/**
 * List all active (not deleted) coupons
 */
export const listCoupons = functions.https.onCall(async (data, context) => {
  // @ts-ignore
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "Authentication required."
    );
  }
  const snap = await couponsRef.where("isDeleted", "==", false).get();
  const coupons = snap.docs.map((doc) => ({ couponId: doc.id, ...doc.data() }));
  return { success: true, coupons };
});
