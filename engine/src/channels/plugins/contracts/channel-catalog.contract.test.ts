// Channel catalog contract tests cover bundled and registry-backed channel catalog invariants.
import fs from "node:fs";
import path from "node:path";
import { isPrereleaseSemverVersion } from "../../../infra/npm-registry-spec.js";
import {
  describeBundledMetadataOnlyChannelCatalogContract,
  describeChannelCatalogEntryContract,
  describeOfficialFallbackChannelCatalogContract,
} from "./test-helpers/channel-catalog-contract.js";

describeChannelCatalogEntryContract({
  channelId: "msteams",
  npmSpec: "@branch/msteams",
  alias: "teams",
});

const whatsappMeta = {
  id: "whatsapp",
  label: "WhatsApp",
  selectionLabel: "WhatsApp (QR link)",
  detailLabel: "WhatsApp Web",
  docsPath: "/channels/whatsapp",
  blurb: "works with your own number; recommend a separate phone + eSIM.",
};

const whatsappPackageJson = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "extensions", "whatsapp", "package.json"), "utf8"),
) as {
  name?: string;
  version?: string;
  branch?: { install?: { npmSpec?: string } };
};
const whatsappNpmSpec = whatsappPackageJson.branch?.install?.npmSpec ?? whatsappPackageJson.name;
const whatsappVersion = whatsappPackageJson.version;
if (!whatsappNpmSpec || !whatsappVersion) {
  throw new Error("missing package metadata for whatsapp");
}
const whatsappOfficialFallbackNpmSpec = isPrereleaseSemverVersion(whatsappVersion)
  ? `${whatsappNpmSpec}@${whatsappVersion}`
  : whatsappNpmSpec;

describeBundledMetadataOnlyChannelCatalogContract({
  pluginId: "whatsapp",
  packageName: "@branch/whatsapp",
  npmSpec: "@branch/whatsapp",
  meta: whatsappMeta,
  defaultChoice: "npm",
});

describeOfficialFallbackChannelCatalogContract({
  channelId: "whatsapp",
  npmSpec: whatsappOfficialFallbackNpmSpec,
  meta: whatsappMeta,
  packageName: "@branch/whatsapp",
  externalNpmSpec: "@vendor/whatsapp-fork",
  externalLabel: "WhatsApp Fork",
});

describeChannelCatalogEntryContract({
  channelId: "wecom",
  npmSpec: "@wecom/wecom-branch-plugin@2026.7.2",
  alias: "wework",
});

describeChannelCatalogEntryContract({
  channelId: "yuanbao",
  npmSpec: "branch-plugin-yuanbao@2.18.2",
  alias: "yb",
});

describeChannelCatalogEntryContract({
  channelId: "branch-zalogrovebot",
  npmSpec: "@zalo-platforms/branch-zalogrovebot@0.1.4",
  alias: "zalogrovebot",
});
