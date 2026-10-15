export type GraphHistory = { liked: Set<number>; passed: Set<number> };

export class GraphLikes {
  history: GraphHistory | null = null;
  pending: number | null = null;

  status(id: number): 'unknown' | 'liking' | 'liked' | 'passed' | 'new' {
    if (this.pending === id) return 'liking';
    if (!this.history) return 'unknown';
    if (this.history.liked.has(id)) return 'liked';
    if (this.history.passed.has(id)) return 'passed';
    return 'new';
  }

  begin(id: number): boolean {
    if (this.pending !== null || this.status(id) !== 'new') return false;
    this.pending = id;
    return true;
  }

  finish(id: number, success: boolean) {
    if (this.pending !== id) return;
    this.pending = null;
    if (success && this.history) this.history = { ...this.history, liked: new Set([...this.history.liked, id]) };
    // An uncertain response must be reconciled before another training request.
    else this.history = null;
  }
}
