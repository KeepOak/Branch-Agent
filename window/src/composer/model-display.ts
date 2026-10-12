/** Keep a model's public name consistent across catalog rows, chips and transcript labels. */
export function displayModelName(name: string): string {
  const gpt = /^gpt-(\d+(?:\.\d+)?)[ -]([a-z]+)$/i.exec(name);
  return gpt ? `GPT-${gpt[1]} ${gpt[2][0].toUpperCase()}${gpt[2].slice(1).toLowerCase()}` : name;
}
