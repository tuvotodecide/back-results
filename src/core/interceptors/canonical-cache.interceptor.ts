import { CACHE_MANAGER, CacheInterceptor } from '@nestjs/cache-manager';
import { Inject, Injectable } from '@nestjs/common';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

@Injectable()
export class CanonicalCacheInterceptor extends CacheInterceptor {
  constructor(
    @Inject(CACHE_MANAGER) cacheManager: any,
    reflector: Reflector,
  ) {
    super(cacheManager, reflector);
  }

  protected trackBy(context: ExecutionContext): string | undefined {
    const key = super.trackBy(context);
    if (typeof key !== 'string') return undefined;
    if (!key.startsWith('/')) return key;

    try {
      const url = new URL(key, 'http://cache.local');
      const entries = [...url.searchParams.entries()]
        .filter(([, value]) => value.trim() !== '')
        .sort(([aKey, aVal], [bKey, bVal]) =>
          aKey === bKey ? aVal.localeCompare(bVal) : aKey.localeCompare(bKey),
        );

      if (entries.length === 0) return url.pathname;

      const params = new URLSearchParams();
      for (const [k, v] of entries) params.append(k, v);
      return `${url.pathname}?${params.toString()}`;
    } catch {
      return key;
    }
  }
}
