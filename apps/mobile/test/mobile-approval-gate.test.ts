import { describe, expect, it, jest } from "@jest/globals";

const mockHasHardwareAsync = jest.fn<() => Promise<boolean>>();
const mockIsEnrolledAsync = jest.fn<() => Promise<boolean>>();
const mockAuthenticateAsync = jest.fn<() => Promise<{ success: boolean }>>();

jest.mock("expo-local-authentication", () => ({
  hasHardwareAsync: (...args: unknown[]) => mockHasHardwareAsync(...(args as [])),
  isEnrolledAsync: (...args: unknown[]) => mockIsEnrolledAsync(...(args as [])),
  authenticateAsync: (...args: unknown[]) => mockAuthenticateAsync(...(args as [])),
}));

import { MobileApprovalGate } from "../src/agent/mobile-approval-gate";

const call = { id: "call-1", toolId: "fs.read_file", input: { path: "notes.txt" } };

describe("MobileApprovalGate", () => {
  it("routes heuristicSandboxed straight to the inline bridge, never touching biometrics", async () => {
    const requestInlineApproval = jest.fn<() => Promise<"approved" | "denied">>().mockResolvedValue("approved");
    const gate = new MobileApprovalGate({ requestInlineApproval });

    const decision = await gate.request(call, "heuristicSandboxed");

    expect(decision).toBe("approved");
    expect(requestInlineApproval).toHaveBeenCalledWith(call);
    expect(mockHasHardwareAsync).not.toHaveBeenCalled();
  });

  it("falls back to the inline bridge for dangerousConfirmRequired when there's no biometric hardware", async () => {
    mockHasHardwareAsync.mockResolvedValue(false);
    const requestInlineApproval = jest.fn<() => Promise<"approved" | "denied">>().mockResolvedValue("denied");
    const gate = new MobileApprovalGate({ requestInlineApproval });

    const decision = await gate.request(call, "dangerousConfirmRequired");

    expect(decision).toBe("denied");
    expect(requestInlineApproval).toHaveBeenCalledWith(call);
    expect(mockAuthenticateAsync).not.toHaveBeenCalled();
  });

  it("falls back to the inline bridge for dangerousConfirmRequired when no biometrics are enrolled", async () => {
    mockHasHardwareAsync.mockResolvedValue(true);
    mockIsEnrolledAsync.mockResolvedValue(false);
    const requestInlineApproval = jest.fn<() => Promise<"approved" | "denied">>().mockResolvedValue("approved");
    const gate = new MobileApprovalGate({ requestInlineApproval });

    await gate.request(call, "dangerousConfirmRequired");

    expect(requestInlineApproval).toHaveBeenCalledWith(call);
    expect(mockAuthenticateAsync).not.toHaveBeenCalled();
  });

  it("requires a successful biometric prompt for dangerousConfirmRequired when hardware is enrolled", async () => {
    mockHasHardwareAsync.mockResolvedValue(true);
    mockIsEnrolledAsync.mockResolvedValue(true);
    mockAuthenticateAsync.mockResolvedValue({ success: true });
    const requestInlineApproval = jest.fn<() => Promise<"approved" | "denied">>();
    const gate = new MobileApprovalGate({ requestInlineApproval });

    const decision = await gate.request(call, "dangerousConfirmRequired");

    expect(decision).toBe("approved");
    expect(requestInlineApproval).not.toHaveBeenCalled();
  });

  it("denies when the biometric prompt itself fails or is cancelled", async () => {
    mockHasHardwareAsync.mockResolvedValue(true);
    mockIsEnrolledAsync.mockResolvedValue(true);
    mockAuthenticateAsync.mockResolvedValue({ success: false });
    const gate = new MobileApprovalGate({ requestInlineApproval: jest.fn<() => Promise<"approved" | "denied">>() });

    const decision = await gate.request(call, "dangerousConfirmRequired");

    expect(decision).toBe("denied");
  });
});
