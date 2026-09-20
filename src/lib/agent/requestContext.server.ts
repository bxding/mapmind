import { AsyncLocalStorage } from 'node:async_hooks';

const context = new AsyncLocalStorage<AbortSignal>();
export const withRequestSignal = <T>(signal: AbortSignal, run: () => T): T => context.run(signal, run);
export const requestSignal = () => context.getStore();
export function checkCancelled() { requestSignal()?.throwIfAborted(); }
