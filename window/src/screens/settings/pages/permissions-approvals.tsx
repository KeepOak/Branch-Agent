// The R1 Permissions page: the re-hosted Classic permissions sections, then the approvals record (preview Approvals
// dialog, opened from Permissions' Approvals row): the standing permissions and what was answered, from useAsks' engine calls.
import type { ReactNode } from "react";
import { AskHistory } from "../../approvals/AskHistory";
import type { PageSlot, SlotPageProps } from "../slots";
import { classicSlot } from "./classic-host";

const classic = classicSlot("permissions", "permissions");
const ClassicPermissions = classic.component!;

function PermissionsWithApprovals(props: SlotPageProps): ReactNode {
  return <>
    <ClassicPermissions {...props} />
    <AskHistory engine={props.engine} />
  </>;
}

export const permissionsSlot: PageSlot = { ...classic, component: PermissionsWithApprovals };
