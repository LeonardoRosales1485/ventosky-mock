/** Lifecycle of an async read: nothing requested yet, in flight, resolved or failed. */
export enum LoadState {
  Idle = 'idle',
  Loading = 'loading',
  Success = 'success',
  Error = 'error',
}
