describe("User Module", () => {
  it("should fail to create user with missing fields", async () => {
    expect.assertions(1);
    try {
      // @ts-ignore
      await require("../src/modules/user").createUser({ data: {} }, {});
    } catch (e) {
      expect(e.code).toBe("invalid-argument");
    }
  });
});
