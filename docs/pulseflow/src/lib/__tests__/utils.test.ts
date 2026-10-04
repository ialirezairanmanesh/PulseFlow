import { describe, expect, it } from "vitest";
import { formatBytes, formatMs } from "@/lib/utils";

describe("formatBytes", () => {
  it("scales units", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MB");
  });

  it("guards invalid input", () => {
    expect(formatBytes(-1)).toBe("—");
    expect(formatBytes(Number.NaN)).toBe("—");
  });
});

describe("formatMs", () => {
  it("formats milliseconds", () => {
    expect(formatMs(16.666)).toBe("16.7 ms");
    expect(formatMs(Number.POSITIVE_INFINITY)).toBe("—");
  });
});
