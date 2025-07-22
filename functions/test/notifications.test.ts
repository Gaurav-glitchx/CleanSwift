describe("Notifications Module", () => {
  it("should fail to send notification with missing fields", async () => {
    expect.assertions(1);
    try {
      // @ts-ignore
      await require("../src/modules/notifications").sendNotification(
        { data: {} },
        { auth: { uid: "user1" } }
      );
    } catch (e) {
      expect(e.code).toBe("invalid-argument");
    }
  });
});
