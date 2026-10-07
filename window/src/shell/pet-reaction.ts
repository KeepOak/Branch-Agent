export type PetReaction = "pat" | "cheer" | "notice";
export const PET_REACTION_MS = 3000;
const scales: Record<string, number> = { mossfrog:1.099, leafhog:.945, fennec:1.034, otter:.982, capybara:1.138, cloverbun:.996, owlet:1.104, shellsnail:1.09, jelly:1.135, cloudsheep:1.015, pebblecrab:.951, caterpillar:1.167, sprigdragon:.893, turtle:1.173, penguin:.917, puppy:1.065, kitten:1.04, raccoon:1.182, koala:1.131, sloth:1.086, fruitbat:1.107, bumblebee:1.219, beetle:1.189, duckling:1.08, hamster:1.199, sealpup:1.212, octopus:1.148, chameleon:1.172, firefly:1.125, dustbunny:1.442, mossgolem:1.132, narwhal:1.041, squirrel:1.247, elephant:1.027, redpanda:1.171, pangolin:1.023, quokka:1.241, goatkid:1.297, piglet:1.088 };
export function petReactionScale(id: string): number { return scales[id] ?? 1.15; }
export function petReactionSource(still: string, reaction: PetReaction): string {
  return still.replace(/\.webp$/, `-${reaction}.webm`);
}
/** Completion and achievement producers can notify visible pets. */
export function reactPet(reaction: PetReaction): void {
  document.dispatchEvent(new CustomEvent("branch:pet-reaction", { detail: reaction }));
}
