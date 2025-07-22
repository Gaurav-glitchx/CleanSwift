import * as functions from "firebase-functions";
import * as admin from "firebase-admin";

const reviewsRef = admin.firestore().collection("reviews");

/**
 * Create a review
 */
export const createReview = functions.https.onCall(async (data, context) => {
  const { orderId, userId, rating, comment, images } = data.data;
  // @ts-ignore
  if (!context.auth || !orderId || !userId || !rating) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Missing required fields."
    );
  }
  // Prevent duplicate review for the same order by the same user
  const dupSnap = await reviewsRef
    .where("orderId", "==", orderId)
    .where("userId", "==", userId)
    .where("isDeleted", "==", false)
    .get();
  if (!dupSnap.empty) {
    throw new functions.https.HttpsError(
      "already-exists",
      "Review already exists for this order by this user."
    );
  }
  const now = Date.now();
  const reviewData = {
    orderId,
    userId,
    rating,
    comment: comment || "",
    images: images || [],
    isDeleted: false,
    createdAt: now,
    updatedAt: now,
  };
  const docRef = await reviewsRef.add(reviewData);
  return { success: true, reviewId: docRef.id };
});

/**
 * Update a review
 */
export const updateReview = functions.https.onCall(async (data, context) => {
  const { reviewId, userId, ...updates } = data.data;
  // @ts-ignore
  if (!context.auth || !reviewId || !userId) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Missing required fields."
    );
  }
  const docRef = reviewsRef.doc(reviewId);
  const doc = await docRef.get();
  if (!doc.exists || doc.data()?.userId !== userId) {
    throw new functions.https.HttpsError("not-found", "Review not found.");
  }
  updates.updatedAt = Date.now();
  await docRef.update(updates);
  return { success: true };
});

/**
 * Soft delete a review
 */
export const deleteReview = functions.https.onCall(async (data, context) => {
  const { reviewId, userId } = data.data;
  // @ts-ignore
  if (!context.auth || !reviewId || !userId) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Missing required fields."
    );
  }
  const docRef = reviewsRef.doc(reviewId);
  const doc = await docRef.get();
  if (!doc.exists || doc.data()?.userId !== userId) {
    throw new functions.https.HttpsError("not-found", "Review not found.");
  }
  await docRef.update({
    isDeleted: true,
    updatedAt: Date.now(),
  });
  return { success: true };
});

/**
 * List all active (not deleted) reviews for a user or order
 */
export const listReviews = functions.https.onCall(async (data, context) => {
  const { userId, orderId } = data.data;
  // @ts-ignore
  if (!context.auth || (!userId && !orderId)) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Missing required fields."
    );
  }
  let query;
  if (userId) {
    query = reviewsRef
      .where("userId", "==", userId)
      .where("isDeleted", "==", false);
  } else {
    query = reviewsRef
      .where("orderId", "==", orderId)
      .where("isDeleted", "==", false);
  }
  const snap = await query.get();
  const reviews = snap.docs.map((doc) => ({ reviewId: doc.id, ...doc.data() }));
  return { success: true, reviews };
});
