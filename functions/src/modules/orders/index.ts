import * as functions from "firebase-functions";
import * as functionsV1 from "firebase-functions/v1";
import * as admin from "firebase-admin";
// import Stripe from "stripe";
import { auditLog, rateLimit } from "../utils";

if (!admin.apps.length) {
  admin.initializeApp();
}

const ordersRef = admin.firestore().collection("orders");
const slotsRef = admin.firestore().collection("slots");
const couponsRef = admin.firestore().collection("coupons");

// const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
//   apiVersion: "2025-06-30.basil",
// });

/**
 * Place a new order
 */
export const createOrder = functions.https.onCall(async (data, context) => {
  const {
    userId,
    providerId,
    items,
    pickupDetails,
    deliveryDetails,
    pricing,
    payment,
    couponCode,
    totalAmount,
    slotId,
  } = data.data;
  if (
    // @ts-ignore
    !context.auth ||
    !userId ||
    !providerId ||
    !items ||
    !pickupDetails ||
    !deliveryDetails ||
    !pricing ||
    !payment ||
    !totalAmount ||
    !slotId
  ) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Missing required fields."
    );
  }
  // Rate limit: 5 orders per user per hour
  try {
    await rateLimit(userId, "createOrder", 5, 3600);
  } catch (err: any) {
    throw new functions.https.HttpsError("resource-exhausted", err.message);
  }
  // Check slot availability and increment booking atomically
  const slotDoc = slotsRef.doc(slotId);
  await admin.firestore().runTransaction(async (t) => {
    const slotSnap = await t.get(slotDoc);
    if (!slotSnap.exists) {
      throw new functions.https.HttpsError("not-found", "Slot not found.");
    }
    const slotData = slotSnap.data();
    if (!slotData) {
      throw new functions.https.HttpsError("not-found", "Slot data not found.");
    }
    const slot = slotData.slots.find((s: any) => s.isActive);
    if (!slot || slot.currentBookings >= slot.maxBookings) {
      throw new functions.https.HttpsError(
        "resource-exhausted",
        "Slot is fully booked."
      );
    }
    slot.currentBookings += 1;
    t.update(slotDoc, { slots: slotData.slots });
  });
  // Coupon validation and application
  let appliedCoupon = null;
  let discount = 0;
  if (couponCode) {
    const couponSnap = await couponsRef
      .where("couponCode", "==", couponCode)
      .where("isDeleted", "==", false)
      .where("isActive", "==", true)
      .get();
    if (couponSnap.empty) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Invalid or inactive coupon code."
      );
    }
    const coupon = couponSnap.docs[0].data();
    const nowDate = new Date();
    if (
      nowDate < coupon.validFrom.toDate() ||
      nowDate > coupon.validTill.toDate()
    ) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Coupon is not valid at this time."
      );
    }
    if (totalAmount < coupon.minValue) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Order does not meet minimum value for coupon."
      );
    }
    discount = Math.min(coupon.maxDiscount, totalAmount * 0.1); // Example: 10% discount up to maxDiscount
    appliedCoupon = couponCode;
  }
  // Create order
  const now = admin.firestore.FieldValue.serverTimestamp();
  const orderData = {
    userId,
    providerId,
    status: "pending",
    items,
    pickupDetails,
    deliveryDetails,
    pricing: { ...pricing, discount },
    payment,
    couponCode: appliedCoupon,
    totalAmount: totalAmount - discount,
    createdAt: now,
    updatedAt: now,
  };
  const docRef = await ordersRef.add(orderData);
  return { success: true, orderId: docRef.id };
});

/**
 * Update order status (admin/provider only)
 */
export const updateOrderStatus = functions.https.onCall(
  async (data, context) => {
    const { orderId, providerId, newStatus } = data.data;
    // @ts-ignore
    if (!context.auth || !orderId || !providerId || !newStatus) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Missing required fields."
      );
    }
    const docRef = ordersRef.doc(orderId);
    const doc = await docRef.get();
    if (!doc.exists || doc.data()?.providerId !== providerId) {
      throw new functions.https.HttpsError("not-found", "Order not found.");
    }
    // Validate status transition
    const validTransitions: Record<string, string[]> = {
      pending: ["processing", "cancelled"],
      processing: ["out for pickup", "cancelled"],
      "out for pickup": ["in progress", "cancelled"],
      "in progress": ["out for delivery", "cancelled"],
      "out for delivery": ["completed", "cancelled"],
      completed: [],
      cancelled: [],
      refunded: [],
    };
    const currentStatus = doc.data()?.status;
    if (!validTransitions[currentStatus]?.includes(newStatus)) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "Invalid status transition."
      );
    }
    await docRef.update({
      status: newStatus,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    // Audit log
    await auditLog({
      // @ts-ignore
      userId: context.auth.uid,
      action: "order_status_update",
      details: { orderId, from: currentStatus, to: newStatus },
      context: { providerId },
    });
    return { success: true };
  }
);

/**
 * List orders for a user or provider
 */
export const listOrders = functions.https.onCall(async (data, context) => {
  const { userId, providerId } = data.data;
  // @ts-ignore
  if (!context.auth || (!userId && !providerId)) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Missing required fields."
    );
  }
  let query;
  if (userId) {
    query = ordersRef.where("userId", "==", userId);
  } else {
    query = ordersRef.where("providerId", "==", providerId);
  }
  const snap = await query.get();
  const orders = snap.docs.map((doc) => ({ orderId: doc.id, ...doc.data() }));
  return { success: true, orders };
});

/**
 * Cancel an order (user or admin)
 */
export const cancelOrder = functions.https.onCall(async (data, context) => {
  const { orderId, userId, providerId, reason, byAdmin } = data.data;
  // @ts-ignore
  if (!context.auth || !orderId || (!userId && !providerId)) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Missing required fields."
    );
  }
  const docRef = ordersRef.doc(orderId);
  const doc = await docRef.get();
  if (!doc.exists) {
    throw new functions.https.HttpsError("not-found", "Order not found.");
  }
  const order = doc.data();
  // Only allow user to cancel their own order, or admin/provider to override
  // @ts-ignore
  if (!byAdmin && context.auth.uid !== order?.userId) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Not allowed to cancel this order."
    );
  }
  // Only allow cancellation before certain statuses (unless admin)
  const nonCancellableStatuses = [
    "out for delivery",
    "completed",
    "cancelled",
    "refunded",
  ];
  if (!byAdmin && nonCancellableStatuses.includes(order?.status)) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Order cannot be cancelled at this stage."
    );
  }
  // All Stripe-related code commented out due to missing env vars
  // If paid, trigger Stripe refund
  // let refundId = null;
  // if (order?.payment?.status === "paid" && order?.payment?.transactionId) {
  //   try {
  //     const refund = await stripe.refunds.create({
  //       payment_intent: order?.payment?.transactionId,
  //     });
  //     refundId = refund.id;
  //     await docRef.update({
  //       "payment.status": "refunded",
  //       "payment.refundId": refundId,
  //     });
  //   } catch (err: any) {
  //     throw new functions.https.HttpsError(
  //       "internal",
  //       "Failed to process refund: " + err.message
  //     );
  //   }
  // }
  // Update order status and log reason
  await docRef.update({
    status: "cancelled",
    cancellationReason: reason || "",
    cancelledBy: byAdmin ? "admin" : "user",
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  // Audit log
  await auditLog({
    // @ts-ignore
    userId: context.auth.uid,
    action: "order_cancelled",
    details: { orderId, reason, byAdmin },
    context: { providerId, userId },
  });
  // Trigger notification (stub)
  // TODO: Call notification function for user/provider
  return { success: true };
});

/**
 * Scheduled function to auto-update order statuses
 * Runs every 15 minutes
 */
export const autoUpdateOrderStatus = functionsV1.pubsub
  .schedule("every 15 minutes")
  .onRun(async (context) => {
    const now = admin.firestore.Timestamp.now();
    // Find orders in 'in progress' status where processing time has elapsed
    const ordersSnap = await ordersRef
      .where("status", "==", "in progress")
      .get();
    const batch = admin.firestore().batch();
    let updatedCount = 0;
    for (const doc of ordersSnap.docs) {
      const order = doc.data();
      if (!order.processingTime || !order.updatedAt) continue;
      // Calculate expected ready time
      const readyTime = order.updatedAt.toDate();
      readyTime.setHours(readyTime.getHours() + order.processingTime);
      if (now.toDate() >= readyTime) {
        batch.update(doc.ref, { status: "out for delivery", updatedAt: now });
        updatedCount++;
      }
    }
    if (updatedCount > 0) {
      await batch.commit();
      functions.logger.info(
        `Auto-updated ${updatedCount} orders to 'out for delivery'.`
      );
    }
    return null;
  });
