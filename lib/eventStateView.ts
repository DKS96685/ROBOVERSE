export interface EventStateView {
  status: 'ready' | 'running' | 'paused' | 'ended';
  isPaused: boolean;
  isRunning: boolean;
  isEnded: boolean;
}

export function toEventStateView(event: { status?: string } | null): EventStateView {
  const status = (event?.status || 'ready') as EventStateView['status'];
  return {
    status,
    isPaused: status === 'paused',
    isRunning: status === 'running',
    isEnded: status === 'ended',
  };
}
