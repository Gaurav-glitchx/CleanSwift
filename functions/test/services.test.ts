describe("Services Module", () => {
  it("should fail to create service with missing fields", async () => {
    expect.assertions(1);
    try {
      // @ts-ignore
      await require("../src/modules/services").createService(
        { data: {} },
        { auth: { uid: "provider1" } }
      );
    } catch (e) {
      expect(e.code).toBe("invalid-argument");
    }
  });
});
