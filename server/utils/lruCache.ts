/**
 * In-memory LRU cache for processed image buffers.
 * Keyed by "{cachePath}:{size}:{format}" — avoids repeated Sharp work for hot images.
 * Budget: configurable max bytes (default 500MB).
 */

interface LRUNode {
  key: string;
  value: ArrayBuffer;
  size: number;
  prev: LRUNode | null;
  next: LRUNode | null;
}

const DEFAULT_MAX_BYTES = 1024 * 1024 * 1024; // 1GB

class LRUCache {
  private map = new Map<string, LRUNode>();
  private head: LRUNode | null = null; // most recently used
  private tail: LRUNode | null = null; // least recently used
  private currentBytes = 0;
  private maxBytes: number;
  private hits = 0;
  private misses = 0;

  constructor(maxBytes: number = DEFAULT_MAX_BYTES) {
    this.maxBytes = maxBytes;
  }

  get(key: string): ArrayBuffer | null {
    const node = this.map.get(key);
    if (!node) {
      this.misses++;
      return null;
    }
    this.hits++;
    this.moveToHead(node);
    return node.value;
  }

  set(key: string, value: ArrayBuffer): void {
    const size = value.byteLength;

    // Don't cache items larger than 10% of budget
    if (size > this.maxBytes * 0.1) return;

    const existing = this.map.get(key);
    if (existing) {
      this.currentBytes -= existing.size;
      existing.value = value;
      existing.size = size;
      this.currentBytes += size;
      this.moveToHead(existing);
    } else {
      const node: LRUNode = { key, value, size, prev: null, next: null };
      this.map.set(key, node);
      this.currentBytes += size;
      this.addToHead(node);
    }

    // Evict until under budget
    while (this.currentBytes > this.maxBytes && this.tail) {
      this.evictTail();
    }
  }

  stats(): { entries: number; currentMB: number; maxMB: number; hits: number; misses: number; hitRate: string } {
    const total = this.hits + this.misses;
    return {
      entries: this.map.size,
      currentMB: Math.round(this.currentBytes / 1024 / 1024 * 100) / 100,
      maxMB: Math.round(this.maxBytes / 1024 / 1024),
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? `${(this.hits / total * 100).toFixed(1)}%` : '0%',
    };
  }

  private addToHead(node: LRUNode): void {
    node.prev = null;
    node.next = this.head;
    if (this.head) {
      this.head.prev = node;
    }
    this.head = node;
    if (!this.tail) {
      this.tail = node;
    }
  }

  private removeNode(node: LRUNode): void {
    if (node.prev) {
      node.prev.next = node.next;
    } else {
      this.head = node.next;
    }
    if (node.next) {
      node.next.prev = node.prev;
    } else {
      this.tail = node.prev;
    }
    node.prev = null;
    node.next = null;
  }

  private moveToHead(node: LRUNode): void {
    if (node === this.head) return;
    this.removeNode(node);
    this.addToHead(node);
  }

  private evictTail(): void {
    if (!this.tail) return;
    const evicted = this.tail;
    this.removeNode(evicted);
    this.map.delete(evicted.key);
    this.currentBytes -= evicted.size;
  }
}

// Singleton instance
const imageCache = new LRUCache(DEFAULT_MAX_BYTES);

/**
 * Build a cache key for a processed image variant
 */
export function lruKey(cachePath: string, size: number | null, format: string): string {
  return `${cachePath}:${size ?? 'full'}:${format}`;
}

export function lruGet(key: string): ArrayBuffer | null {
  return imageCache.get(key);
}

export function lruSet(key: string, buffer: ArrayBuffer): void {
  imageCache.set(key, buffer);
}

export function lruStats() {
  return imageCache.stats();
}
