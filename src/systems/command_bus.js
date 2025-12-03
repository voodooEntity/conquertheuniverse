export class CommandBus {
  constructor() {
    this.listeners = new Map();
  }
  on(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
    return () => this.off(type, fn);
  }
  off(type, fn) {
    this.listeners.get(type)?.delete(fn);
  }
  emit(type, payload) {
    this.listeners.get(type)?.forEach((fn) => fn(payload));
  }
}

// Command types
export const CMD = Object.freeze({
  MOVE_SELECTED_TO: 'MOVE_SELECTED_TO',
});
