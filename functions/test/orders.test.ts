describe("Orders Module", () => {
  it("should fail to create order with missing fields", async () => {
    expect.assertions(1);
    try {
      // @ts-ignore
      await require("../src/modules/orders").createOrder(
        { data: {} },
        { auth: { uid: "user1" } }
      );
    } catch (e) {
      expect(e.code).toBe("invalid-argument");
    }
  });
});
