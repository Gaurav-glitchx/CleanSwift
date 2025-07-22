describe("Payments Module", () => {
  it("should fail to create payment intent with missing fields", async () => {
    expect.assertions(1);
    try {
      // @ts-ignore
      await require("../src/modules/payments").createPaymentIntent(
        { data: {} },
        { auth: { uid: "user1" } }
      );
    } catch (e) {
      expect(e.code).toBe("invalid-argument");
    }
  });
});
