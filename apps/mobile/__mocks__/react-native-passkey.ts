// The system's passkeys in tests: none on the device. A test of the second step gives its own (fakeWebApp's devices).
export const Passkey = {
  isSupported: () => true,
  get: async () => {
    throw Object.assign(new Error("No credentials"), { error: "NoCredentials" });
  },
};
