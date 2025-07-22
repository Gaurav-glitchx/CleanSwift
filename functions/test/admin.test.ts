describe("Admin Module", () => {
  it("should fail to create admin with missing fields", async () => {
    // Simulate calling the function with missing data
    // (In real test, use firebase-functions-test or emulator)
    expect.assertions(1);
    try {
      // @ts-ignore
      await require("../src/modules/admin").createAdmin({ data: {} }, {});
    } catch (e) {
      expect(e.code).toBe("invalid-argument");
    }
  });
});
