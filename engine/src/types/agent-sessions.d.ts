// Declares extension points for agent session type augmentation.
export type BranchAgentSessionSkillSourceAugmentation = never;

declare module "branch/plugin-sdk/agent-sessions" {
  interface Skill {
    // Branch Agent relies on the source identifier returned by skill loaders.
    source: string;
  }
}
