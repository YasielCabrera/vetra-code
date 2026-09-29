import { describe, expect, it } from "vite-plus/test";
import { providerAuthReturnUrl } from "./providerAuthReturnUrl.ts";

describe("provider auth return destinations", () => {
  it.each(["vetra", "vetra-dev"])(
    "returns to %s Welcome and the selected settings instance",
    (scheme) => {
      expect(providerAuthReturnUrl(`${scheme}://app/welcome?code=secret#agents:machine-id`)).toBe(
        `${scheme}://app/welcome#agents:machine-id`,
      );
      expect(
        providerAuthReturnUrl(`${scheme}://app/settings/providers?instanceId=work&code=secret`),
      ).toBe(`${scheme}://app/settings/providers?instanceId=work`);
    },
  );
  it.each([
    "vetra://attacker/welcome",
    "vetra://app:123/welcome",
    "vetra://app/auth/callback",
    "vetra://user@ app/welcome",
    "vetra://app/welcome/../evil",
    "https://attacker.example/welcome",
    "file:///welcome",
    "javascript:alert(1)",
  ])("rejects %s", (url) => expect(providerAuthReturnUrl(url)).toBeUndefined());
});
