import { getItem, setItem } from './localDB';

export interface ScreenLoadMetric {
  screen: string;
  durationMs: number;
  timestamp: number;
}

export interface ApiTimingMetric {
  endpoint: string;
  method: string;
  durationMs: number;
  status?: number;
  timestamp: number;
}

export interface MemorySample {
  source: string;
  bytes: number;
  timestamp: number;
}

export interface PerformanceSnapshot {
  screenLoads: ScreenLoadMetric[];
  apiTimings: ApiTimingMetric[];
  memorySamples: MemorySample[];
}

export interface PerformanceDashboard {
  latestMemorySample: MemorySample | null;
  topScreenLoads: ScreenLoadMetric[];
  topApiTimings: ApiTimingMetric[];
  averageScreenLoadMs: number;
  averageApiTimingMs: number;
}

const PERFORMANCE_KEY = '@performance_metrics';
const DEFAULT_SNAPSHOT: PerformanceSnapshot = {
  screenLoads: [],
  apiTimings: [],
  memorySamples: [],
};

async function readSnapshot(): Promise<PerformanceSnapshot> {
  const stored = await getItem(PERFORMANCE_KEY);
  if (!stored) return DEFAULT_SNAPSHOT;

  try {
    const parsed = JSON.parse(stored) as Partial<PerformanceSnapshot>;
    return {
      screenLoads: Array.isArray(parsed.screenLoads) ? parsed.screenLoads : [],
      apiTimings: Array.isArray(parsed.apiTimings) ? parsed.apiTimings : [],
      memorySamples: Array.isArray(parsed.memorySamples) ? parsed.memorySamples : [],
    };
  } catch {
    return DEFAULT_SNAPSHOT;
  }
}

async function writeSnapshot(snapshot: PerformanceSnapshot): Promise<void> {
  await setItem(PERFORMANCE_KEY, JSON.stringify(snapshot));
}

function trim<T>(items: T[], limit = 50): T[] {
  return items.slice(Math.max(0, items.length - limit));
}

export async function recordScreenLoad(screen: string, durationMs: number): Promise<void> {
  const snapshot = await readSnapshot();
  snapshot.screenLoads = trim([
    ...snapshot.screenLoads,
    { screen, durationMs, timestamp: Date.now() },
  ]);
  await writeSnapshot(snapshot);
}

export async function recordApiTiming(
  endpoint: string,
  method: string,
  durationMs: number,
  status?: number,
): Promise<void> {
  const snapshot = await readSnapshot();
  snapshot.apiTimings = trim([
    ...snapshot.apiTimings,
    { endpoint, method, durationMs, status, timestamp: Date.now() },
  ]);
  await writeSnapshot(snapshot);
}

export async function recordMemorySample(source: string): Promise<void> {
  const globalScope = globalThis as typeof globalThis & {
    performance?: { memory?: { usedJSHeapSize?: number } };
    process?: { memoryUsage?: () => { rss?: number } };
  };

  const bytes = Number(
    globalScope.performance?.memory?.usedJSHeapSize ??
      globalScope.process?.memoryUsage?.().rss ??
      0,
  );
  const snapshot = await readSnapshot();
  snapshot.memorySamples = trim([
    ...snapshot.memorySamples,
    { source, bytes, timestamp: Date.now() },
  ]);
  await writeSnapshot(snapshot);
}

export async function getPerformanceDashboard(): Promise<PerformanceDashboard> {
  const snapshot = await readSnapshot();
  const latestMemorySample = snapshot.memorySamples[snapshot.memorySamples.length - 1] ?? null;

  const average = (values: number[]) =>
    values.length === 0
      ? 0
      : Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);

  return {
    latestMemorySample,
    topScreenLoads: [...snapshot.screenLoads]
      .sort((a, b) => b.durationMs - a.durationMs)
      .slice(0, 5),
    topApiTimings: [...snapshot.apiTimings].sort((a, b) => b.durationMs - a.durationMs).slice(0, 5),
    averageScreenLoadMs: average(snapshot.screenLoads.map((item) => item.durationMs)),
    averageApiTimingMs: average(snapshot.apiTimings.map((item) => item.durationMs)),
  };
}

export async function clearPerformanceMetrics(): Promise<void> {
  await writeSnapshot(DEFAULT_SNAPSHOT);
}

export async function getPerformanceSnapshot(): Promise<PerformanceSnapshot> {
  return readSnapshot();
}
