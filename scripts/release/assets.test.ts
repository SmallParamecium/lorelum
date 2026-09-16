import { expect, test } from "bun:test";
import { releaseAssetNames } from "./assets";

test("release assets use the versioned target-specific naming convention", () => {
  expect(releaseAssetNames("0.1.0-alpha.2", "darwin-arm64", false)).toEqual({
    packageName: "lore-0.1.0-alpha.2-darwin-arm64",
    archiveFileName: "lore-0.1.0-alpha.2-darwin-arm64.tar.gz",
    metadataFileName: "lore-0.1.0-alpha.2-darwin-arm64.metadata.json",
  });
  expect(releaseAssetNames("0.1.0-alpha.2", "win32-x64", true)).toEqual({
    packageName: "lore-0.1.0-alpha.2-win32-x64",
    archiveFileName: "lore-0.1.0-alpha.2-win32-x64.zip",
    metadataFileName: "lore-0.1.0-alpha.2-win32-x64.metadata.json",
  });
});
