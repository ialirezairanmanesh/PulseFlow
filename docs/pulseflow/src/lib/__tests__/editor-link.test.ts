import { describe, expect, it } from "vitest";
import { toEditorUrl } from "@/lib/editor-link";

describe("toEditorUrl", () => {
  it("links an absolute path with a line", () => {
    expect(toEditorUrl("/home/dev/app/lib/card.dart", 42)).toBe(
      "vscode://file/home/dev/app/lib/card.dart:42",
    );
  });

  it("links a file:// URI", () => {
    expect(toEditorUrl("file:///home/dev/app/lib/card.dart", 7)).toBe(
      "vscode://file/home/dev/app/lib/card.dart:7",
    );
  });

  it("omits the line when absent or invalid", () => {
    expect(toEditorUrl("/a/b.dart")).toBe("vscode://file/a/b.dart");
    expect(toEditorUrl("/a/b.dart", 0)).toBe("vscode://file/a/b.dart");
  });

  it("normalizes Windows paths", () => {
    expect(toEditorUrl("C:\\proj\\a.dart", 3)).toBe("vscode://file/C:/proj/a.dart:3");
  });

  it("returns null for package: and dart: URIs", () => {
    expect(toEditorUrl("package:app/main.dart", 1)).toBeNull();
    expect(toEditorUrl("dart:async", 1)).toBeNull();
    expect(toEditorUrl(undefined, 1)).toBeNull();
  });
});
