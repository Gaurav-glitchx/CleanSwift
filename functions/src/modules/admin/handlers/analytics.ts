import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { validateAdminSession } from "../session";

export const getProviderAnalytics = functions.https.onCall(
  async (data, context: any) => {
    if (!context || !context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Authentication required."
      );
    }
    const { sessionId, providerId, startDate, endDate } = data.data;
    await validateAdminSession(sessionId, context.auth.uid);
    if (!providerId) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Authentication required."
      );
    }
    let orderQuery = admin
      .firestore()
      .collection("orders")
      .where("providerId", "==", providerId);
    if (startDate)
      orderQuery = orderQuery.where("createdAt", ">=", new Date(startDate));
    if (endDate)
      orderQuery = orderQuery.where("createdAt", "<=", new Date(endDate));
    const ordersSnap = await orderQuery.get();
    const orders = ordersSnap.docs.map((doc) => doc.data());
    const totalRevenue = orders.reduce(
      (sum, o) => sum + (o.payment?.status === "paid" ? o.totalAmount || 0 : 0),
      0
    );
    const orderCount = orders.length;
    const uniqueUsers = new Set(orders.map((o) => o.userId));
    const activeCustomers = uniqueUsers.size;
    const serviceCounts: Record<string, number> = {};
    orders.forEach((o) => {
      (o.items || []).forEach((item: any) => {
        if (!serviceCounts[item.serviceId]) serviceCounts[item.serviceId] = 0;
        serviceCounts[item.serviceId] += item.quantity || 1;
      });
    });
    const topServices = Object.entries(serviceCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([serviceId, count]) => ({ serviceId, count }));
    const reviewsSnap = await admin
      .firestore()
      .collection("reviews")
      .where("isDeleted", "==", false)
      .where("providerId", "==", providerId)
      .get();
    const reviews = reviewsSnap.docs.map((doc) => doc.data());
    const avgReview = reviews.length
      ? reviews.reduce((sum, r) => sum + (r.rating || 0), 0) / reviews.length
      : null;
    return {
      success: true,
      totalRevenue,
      orderCount,
      activeCustomers,
      avgReview,
      topServices,
    };
  }
);

export const summarizeReviews = functions.https.onCall(
  async (data, context: any) => {
    if (!context || !context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Authentication required."
      );
    }
    const { sessionId, providerId, limit } = data.data;
    await validateAdminSession(sessionId, context.auth.uid);
    if (!providerId) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Authentication required."
      );
    }
    const reviewsSnap = await admin
      .firestore()
      .collection("reviews")
      .where("providerId", "==", providerId)
      .where("isDeleted", "==", false)
      .orderBy("createdAt", "desc")
      .limit(limit || 20)
      .get();
    const reviews = reviewsSnap.docs.map((doc) => doc.data());
    const avgRating = reviews.length
      ? reviews.reduce((sum, r) => sum + (r.rating || 0), 0) / reviews.length
      : null;
    const summary = `You have ${
      reviews.length
    } recent reviews. Average rating: ${
      avgRating ? avgRating.toFixed(2) : "N/A"
    }.`;
    const suggestions =
      avgRating && avgRating < 4
        ? "Consider improving service quality or response time."
        : "Keep up the good work!";
    return { success: true, summary, suggestions };
  }
);
