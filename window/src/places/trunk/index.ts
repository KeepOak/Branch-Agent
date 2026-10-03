// The Trunk family, for any area that opens a Trunk: the profile (the thread header's face and name open it),
// the editor, Remove, "Have Branch make a Trunk" and the face these screens draw.
export { TrunkProfile, type TrunkProfileProps } from "./TrunkProfile";
export { TrunkEditor, type TrunkEditorProps, type EditorTab } from "./TrunkEditor";
export { RemoveTrunkDialog, type RemoveTrunkProps } from "./RemoveTrunk";
export { TrunkStudio, type TrunkStudioProps } from "./TrunkStudio";
export { TrunkFace } from "./TrunkFace";
export { createTrunk, newTrunkName } from "./api";
