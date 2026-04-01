export function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max - 1) + '…';
}

export function formatDuration(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m${sec % 60}s`;
  const hrs = Math.floor(min / 60);
  return `${hrs}h${min % 60}m`;
}

export function timeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

export function progressBar(current: number, max: number, width: number): string {
  const pct = Math.min(current / max, 1);
  const filled = Math.round(pct * width);
  const empty = width - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

export function meterBar(value: number, max: number, width: number): string {
  const pct = Math.min(value / max, 1);
  const filled = Math.round(pct * width);
  const empty = width - filled;
  return '▓'.repeat(filled) + '░'.repeat(empty);
}

export function meterColor(pct: number): string {
  if (pct > 0.85) return '#FF4444';
  if (pct > 0.6) return '#FFAA00';
  return '#00FF88';
}

export function formatMB(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)}GB`;
  return `${Math.round(mb)}MB`;
}
