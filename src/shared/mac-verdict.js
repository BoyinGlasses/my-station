// Shared system-health verdict key used by both the 3D office Mac drawer and the compact sidebar panel.
export const GB = 1024 ** 3;

export function verdictKey(s) {
  const swap = s.mem.swapUsed;
  if (s.mem.pressure === 'critical') return swap > GB ? 'critical' : 'squeeze';
  if (s.mem.pressure === 'warn') return swap > GB ? 'swap' : 'squeeze';
  if (swap > 4 * GB) return 'swapLeft';
  if (s.diskTight) return 'disk';
  if (s.cpu.percent > 85) return 'cpu';
  return 'ok';
}
