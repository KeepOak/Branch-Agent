// Settings › Sign-ins & keys: Classic's own blocks inside the R1 cards (spec-rows ClassicBlock), on the same calls. As
// Classic hides this page without operator.admin, a connection that may not change setup sees why instead of the keys.
import { SecretsBlock } from "../../../places/settings/set2/secrets";
import type { SlotControlProps } from "../slots";
import { ADMIN_ONLY } from "./classic-host";
import { ClassicBlock } from "./spec-rows";

const mayAdmin = (p: SlotControlProps) => p.engine.scopes.length === 0 || p.engine.scopes.includes("operator.admin");
const AdminOnly = () => <small className="r1s-msg g-label" role="status" data-lines>{ADMIN_ONLY}</small>;

export const Where = (props: SlotControlProps) => (mayAdmin(props) ? <ClassicBlock {...props} draw={(c) => <SecretsBlock {...c.props} part="where" />} /> : <AdminOnly />);
export const Keys = (props: SlotControlProps) => (mayAdmin(props) ? <ClassicBlock {...props} draw={(c) => <SecretsBlock {...c.props} part="keys" />} /> : <AdminOnly />);
