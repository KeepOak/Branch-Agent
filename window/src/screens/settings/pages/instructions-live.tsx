// Settings › Instructions & personality: Classic's own blocks inside the R1 cards (spec-rows ClassicBlock): Just about
// you (users.personalFile.*) and the files each Trunk reads with their editor (agents.files.*).
import { AboutYouBlock, InstructionFiles } from "../../../places/settings/set1/instructions";
import type { SlotControlProps } from "../slots";
import { ClassicBlock } from "./spec-rows";

export const AboutYou = (props: SlotControlProps) => <ClassicBlock {...props} draw={(c) => <AboutYouBlock {...c.props} />} />;
export const Files = (props: SlotControlProps) => <ClassicBlock {...props} draw={(c) => <InstructionFiles {...c.props} />} />;
