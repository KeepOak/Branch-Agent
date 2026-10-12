// A Trunk's own instruction files (Technical, behind the profile's "Its folder" row): agents.files.get / set with
// compare-and-save, through the Library's FileEditor.
import { useState } from "react";
import type { WindowEngine } from "../../connect/engine";
import { FileEditor, Tabs } from "../library/ui";

const FILES = ["SOUL.md", "IDENTITY.md", "AGENTS.md", "TOOLS.md", "USER.md", "MEMORY.md", "HEARTBEAT.md"];

export function TrunkFiles({ engine, agentId }: { engine: WindowEngine; agentId: string }) {
  const [file, setFile] = useState(FILES[0]);
  return (
    <section className="tk-files kp">
      <Tabs label="Its files" values={FILES} value={file} onChange={setFile} />
      <FileEditor key={file} engine={engine} agentId={agentId} name={file} />
    </section>
  );
}
