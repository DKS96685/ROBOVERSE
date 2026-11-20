/** Generates the next unused teamNN login ID without imposing a team-count cap. */
export function nextTeamLoginId(existingLoginIds: Iterable<string>): string {
  const used = new Set(Array.from(existingLoginIds, (id) => id.toLowerCase()));
  let number = 1;
  while (used.has(`team${String(number).padStart(2, '0')}`)) number++;
  return `team${String(number).padStart(2, '0')}`;
}

export function reserveTeamLoginIds(existingLoginIds: Iterable<string>, count: number): string[] {
  const used = new Set(Array.from(existingLoginIds, (id) => id.toLowerCase()));
  const result: string[] = [];
  while (result.length < count) {
    const id = nextTeamLoginId(used);
    used.add(id);
    result.push(id);
  }
  return result;
}
