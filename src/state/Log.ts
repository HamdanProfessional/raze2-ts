/**
 * Analytics / sponsor-API shim. Ported from Log.as.
 *
 * The original Log talked to the ArmorGames/Mochi analytics service over the
 * network (View/Play/Goal/metric calls). None of that is meaningful in a
 * standalone port, so these are no-ops that optionally echo to the console when
 * debugging. The API surface is preserved so callers don't need changing.
 */
const DEBUG = false;

function trace(label: string, ...args: unknown[]): void {
  if (DEBUG) console.debug(`[Log] ${label}`, ...args);
}

export const Log = {
  View(id = 0, guid = "", url = "", flag = false): void {
    trace("View", id, guid, url, flag);
  },
  Play(): void {
    trace("Play");
  },
  PingServer(): void {
    trace("PingServer");
  },
  Goal(id: number, name: string): void {
    trace("Goal", id, name);
  },
  CustomMetric(name: string): void {
    trace("CustomMetric", name);
  },
  LevelCounterMetric(name: string, value: unknown): void {
    trace("LevelCounterMetric", name, value);
  },
  LevelRangedMetric(name: string, value: unknown, range: number): void {
    trace("LevelRangedMetric", name, value, range);
  },
  LevelAverageMetric(name: string, value: unknown, range: number): void {
    trace("LevelAverageMetric", name, value, range);
  },
} as const;
