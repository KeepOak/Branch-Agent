import { useState } from "react";
import { Btn, Ctl } from "../kit";
import { copyText } from "../../../thread/context";

export type VersionDetails = {
  version: string;
  track: string;
  engineBuild: string;
  desktopBuild: string;
  os: string;
};

export function versionInfoText(details: VersionDetails): string {
  return [
    `Branch: ${details.version || "Unavailable"}`,
    `Release track: ${details.track || "Unavailable"}`,
    `Engine build: ${details.engineBuild || "Unavailable"}`,
    `Desktop build: ${details.desktopBuild || "Not in the desktop app"}`,
    `OS: ${details.os || "Unavailable"}`,
  ].join("\n");
}

export function VersionInfo({ details }: { details: VersionDetails }) {
  const [note, setNote] = useState("");
  return <Ctl title="Version info" sub={note || "Copy the details support needs to reproduce an issue."}>
      <Btn sm onClick={() => void copyText(versionInfoText(details), setNote)}>Copy version info</Btn>
    </Ctl>;
}
