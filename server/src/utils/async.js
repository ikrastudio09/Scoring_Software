/** Serialises async work per key (one scoring command at a time per match). */
export class KeyedMutex {
  constructor() { this.tails = new Map(); }

  run(key, fn) {
    const prev = this.tails.get(key) || Promise.resolve();
    const result = prev.then(fn, fn);
    const tail = result.catch(() => {});
    this.tails.set(key, tail);
    tail.then(() => { if (this.tails.get(key) === tail) this.tails.delete(key); });
    return result;
  }
}
