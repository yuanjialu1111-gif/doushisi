export function declaredWaitMatches(declared: readonly number[] | null, sourceCode: number | null): boolean {
  return declared !== null && sourceCode !== null && declared.includes(sourceCode);
}

export function sameDeclaredWaits(left: readonly number[] | null, right: readonly number[] | null): boolean {
  if (left === null || right === null) return left === right;
  const a = [...left].sort((x, y) => x - y);
  const b = [...right].sort((x, y) => x - y);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
