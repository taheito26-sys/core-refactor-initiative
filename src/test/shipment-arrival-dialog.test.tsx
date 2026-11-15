import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ShipmentStop } from "@/features/shipments/types";
const mocks = vi.hoisted(() => ({ fix: vi.fn(), mutate: vi.fn() }));
vi.mock("@/features/shipments/location", () => ({ getFix: mocks.fix }));
vi.mock("@/features/shipments/hooks", () => ({
  useReachStop: () => ({ mutate: mocks.mutate, isPending: false }),
}));
import { ArrivalDialog } from "@/features/shipments/components/ArrivalDialog";
const stop = {
  id: "s",
  shipment_id: "t",
  seq: 2,
  name_en: "Kafr El Sheikh",
  name_ar: "كفر الشيخ",
  kind: "fixed",
  reached_at: null,
  latitude: 31.111,
  longitude: 30.939,
  radius_km: 20,
} as ShipmentStop;
beforeEach(() => {
  vi.clearAllMocks();
});
describe("Arrival confirmation", () => {
  it("allows a nearby accurate fix and sends its evidence", async () => {
    mocks.fix.mockResolvedValue({
      latitude: 31.111,
      longitude: 30.939,
      accuracy: 20,
      timestamp: Date.now(),
    });
    render(<ArrivalDialog stop={stop} lang="en" onClose={vi.fn()} />);
    await screen.findByText("GPS matches the expected stop area.");
    fireEvent.click(screen.getByRole("button", { name: "Confirm arrival" }));
    expect(mocks.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        stopId: "s",
        fix: expect.objectContaining({ latitude: 31.111 }),
      }),
      expect.any(Object),
    );
  });
  it("requires a real explanation before a far-away arrival can be confirmed", async () => {
    mocks.fix.mockResolvedValue({
      latitude: 25.285,
      longitude: 51.531,
      accuracy: 20,
      timestamp: Date.now(),
    });
    render(<ArrivalDialog stop={stop} lang="en" onClose={vi.fn()} />);
    await screen.findByText(/from the expected stop/);
    const button = screen.getByRole("button", {
      name: "Confirm arrival",
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(mocks.mutate).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Confirmed with dispatch; GPS is inaccurate" },
    });
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(mocks.mutate.mock.calls[0][0].reason).toContain("GPS is inaccurate");
  });
  it("supports an explained override when GPS is unavailable", async () => {
    mocks.fix.mockRejectedValue(new Error("denied"));
    render(<ArrivalDialog stop={stop} lang="ar" onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("textbox")).toBeTruthy());
    expect(
      (
        screen.getByRole("button", {
          name: "تأكيد الوصول",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
});
