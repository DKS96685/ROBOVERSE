export function runOnce(guard: { current: boolean }, callback: () => void): boolean {
  if (guard.current) return false;
  guard.current = true;
  callback();
  return true;
}
