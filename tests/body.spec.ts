import { describe, it, expect } from "vitest";
import { trialDataset, trialSongs } from "../fixtures/dome2024";
import {
  analyze,
  compareSetlistSongs,
  effectiveEntries,
  deriveOverrides,
  validateDataset,
  medley,
  unheard,
  mergeLocalSong,
  templateImpact,
  exportJson,
  parseBackup,
  importPreview,
  initialImportPreflight,
  validateFreshInitialArchive,
  canonicalDatasetJson,
} from "../shared/domain";
import { mergeCandidates } from "../shared/universe";
describe("v0.24 setlists and analytics", () => {
  it("keeps missing setlists out of denominators; cover remains heard", () => {
    const d = trialDataset();
    validateDataset(d);
    const stats = analyze(d, d.shows);
    expect(stats).toHaveLength(29);
    expect(stats.every((s) => s.shows === 1 && s.rate === 1)).toBe(true);
    expect(effectiveEntries(d, d.shows[0])).toBeNull();
    const heard = new Set(stats.map((x) => x.songRef));
    expect(heard.has("L:local-to-the-first")).toBe(true);
    expect(
      unheard(
        [
          ...trialSongs,
          { ...trialSongs[0], ref: "U:unit", artist: "UNIT" },
          { ...trialSongs[0], ref: "U:subunit", artist: "BE:FIRST" },
        ],
        heard,
      ).map((s) => s.ref),
    ).toEqual(["U:subunit"]);
  });
  it("Slogan SHORT+FULL counts 2 performances, 1 show; null is not FULL", () => {
    const d = trialDataset(),
      t = d.templates[0];
    t.entries = [
      { ...t.entries[0], id: "a", songRef: "U:1032", version: "SHORT" },
      { ...t.entries[0], id: "b", songRef: "U:1032", version: "FULL" },
      { ...t.entries[0], id: "c", songRef: "U:1032", version: null },
    ];
    expect(analyze(d, d.shows)[0]).toMatchObject({
      performances: 3,
      shows: 1,
      full: 1,
      short: 1,
      rate: 1,
    });
  });
  it("preflights history without replacing attendance or silently overwriting shows", () => {
    const incoming = trialDataset();
    const empty = { ...trialDataset(), tours: [], shows: [], templates: [], overrides: [], directEntries: [], entryFacts: [], localSongs: [], songMetadata: [], releases: [], releaseTracks: [], attendance: [] };
    const fresh = initialImportPreflight(empty, incoming, trialSongs);
    expect(fresh.newShows).toBe(incoming.shows.length);
    expect(fresh.showOverlaps).toHaveLength(0);
    const current = trialDataset();
    const original = JSON.stringify(current);
    const report = initialImportPreflight(current, incoming, trialSongs);
    expect(report.newShows).toBe(0);
    expect(report.showOverlaps).toHaveLength(incoming.shows.length);
    expect(report.matchingTours.length).toBeGreaterThan(0);
    expect(report.requiresManualReconciliation).toBe(true);
    expect(JSON.stringify(current)).toBe(original);
  });
  it("allows approved first-run data only when the current dataset is empty and songs are resolved", () => {
    const source = trialDataset();
    const empty = {
      ...source, tours: [], shows: [], templates: [], overrides: [],
      directEntries: [], entryFacts: [], localSongs: [], songMetadata: [],
      releases: [], releaseTracks: [], attendance: [],
    };
    const result = validateFreshInitialArchive(empty, source, trialSongs);
    expect(result.newShows).toBe(4);
    expect(() => validateFreshInitialArchive(source, source, trialSongs)).toThrow(/空ではありません/);
    expect(() => validateFreshInitialArchive(empty, source, [])).toThrow(/Universe/);
    expect(() => validateFreshInitialArchive(empty, source, [trialSongs[0]])).toThrow(/SongID/);
    const withAttendance = structuredClone(source);
    withAttendance.attendance.push({
      id: "test", revision: 0, showId: source.shows[0].id,
      attended: true, seat: "", note: "",
      createdAt: "2026-11-12T01:00:00+09:00",
      updatedAt: "2026-11-12T01:00:00+09:00",
    });
    expect(() => validateFreshInitialArchive(empty, withAttendance, trialSongs)).toThrow(/参戦記録/);
    expect(() => validateFreshInitialArchive(empty, empty, trialSongs)).toThrow(/公演/);
  });
  it("blocks same-ID different-date collisions in the import preflight", () => {
    const current = trialDataset();
    const incoming = trialDataset();
    incoming.shows[0].date = "2020-01-01";
    const report = initialImportPreflight(current, incoming);
    expect(report.unsafeShowIds).toEqual([expect.objectContaining({ incomingId: incoming.shows[0].id })]);
    expect(report.entityIdConflicts).toContainEqual({ collection: "shows", id: incoming.shows[0].id });
  });
  it("hides empty comparisons, ignores games and deduplicates repeated performances", () => {
    const d = trialDataset();
    const a = d.templates[0].entries[0];
    const b = d.templates[0].entries[1];
    const current = [a, { ...a, id: "repeat" }, { ...b, id: "game", countsAsPerformance: false, arrangement: "ARRANGED" as const }];
    const other = [a, { ...b, id: "new" }];
    expect(compareSetlistSongs(current, [a])).toEqual({ currentOnly: [], otherOnly: [] });
    expect(compareSetlistSongs(current, other)).toEqual({ currentOnly: [], otherOnly: [b.songRef] });
    expect(compareSetlistSongs(other, current)).toEqual({ currentOnly: [b.songRef], otherOnly: [] });
  });
  it("treats normal and arranged songs as one track while excluding only non-performance corners", () => {
    const d = trialDataset();
    const t = d.templates[0];
    const base = t.entries[0];
    t.entries = [
      { ...base, id: "normal", songRef: "U:1023", arrangement: "NORMAL", countsAsPerformance: true },
      { ...base, id: "acoustic", songRef: "U:1023", arrangement: "ARRANGED", note: "アコースティック", countsAsPerformance: true },
      { ...base, id: "game", songRef: "U:1023", arrangement: "ARRANGED", note: "歌割り変更ゲーム", countsAsPerformance: false },
    ];
    const stats = analyze(d, d.shows);
    expect(stats).toHaveLength(1);
    expect(stats[0]).toMatchObject({ songRef: "U:1023", performances: 2, shows: 1, full: 2 });
    expect(effectiveEntries(d, d.shows[1])).toHaveLength(3);
    expect(validateDataset(d)).toEqual(d);
  });
  it("persists arrangement and counted-performance changes in template overrides", () => {
    const d = trialDataset();
    const base = d.templates[0].entries[0];
    const desired = [{ ...base, arrangement: "ARRANGED" as const, countsAsPerformance: false, note: "歌割り変更ゲーム" }];
    const operations = deriveOverrides([base], desired);
    expect(operations).toEqual([{ kind: "PATCH", target: base.id, patch: {
      arrangement: "ARRANGED", countsAsPerformance: false, note: "歌割り変更ゲーム",
    }}]);
    d.overrides.push({id:"test-override",revision:0,showId:d.shows[1].id,templateId:d.templates[0].id,operations});
    expect(effectiveEntries(d,d.shows[1])?.[0]).toMatchObject(desired[0]);
  });
  it("reads legacy setlists with normal and counted defaults", () => {
    const d = trialDataset();
    const e: any = d.templates[0].entries[0];
    delete e.arrangement; delete e.countsAsPerformance; delete e.note;
    const normalized = validateDataset(d);
    expect(normalized.templates[0].entries[0]).toMatchObject({
      arrangement: "NORMAL", countsAsPerformance: true, note: "",
    });
    expect(analyze(normalized, normalized.shows)).toHaveLength(29);
  });
  it("medley setting normalizes SHORT and removal restores FULL", () => {
    const e = trialDataset().templates[0].entries[0];
    expect(medley(e, "m").version).toBe("SHORT");
    expect(medley(medley(e, "m"), null).version).toBe("FULL");
  });
  it("stores only differences and preserves template additions and show-specific facts", () => {
    const d = trialDataset(),
      t = d.templates[0],
      s = d.shows[1];
    d.shows[0] = { ...d.shows[0], templateId: t.id, hasSavedSetlist: true };
    const desired = structuredClone(t.entries);
    desired[0].songRef = "U:1032";
    [desired[1], desired[2]] = [desired[2], desired[1]];
    const operations = deriveOverrides(t.entries, desired);
    expect(operations.some((o) => o.kind === "REMOVE")).toBe(false);
    d.overrides = [
      { id: s.id, showId: s.id, templateId: t.id, revision: 0, operations },
    ];
    d.entryFacts = [
      {
        id: "fact",
        revision: 0,
        showId: s.id,
        entryKey: t.entries[0].id,
        unpublishedBeforeShow: true,
        firstPerformedAtShow: true,
        note: "",
      },
    ];
    expect(effectiveEntries(d, s)).toEqual(desired);
    expect(effectiveEntries(d, d.shows[0])![0].songRef).toBe("U:1003");
    t.entries.push({ ...t.entries[0], id: "new-base" });
    expect(effectiveEntries(d, s)?.some((x) => x.id === "new-base")).toBe(true);
    validateDataset(d);
    const broken = {
      ...t,
      entries: t.entries.filter((e) => e.id !== "entry-01"),
    };
    expect(
      templateImpact(d, broken).find((x) => x.showId === s.id)?.conflict,
    ).toBeTruthy();
  });
  it("detects orphan facts, mismatched tours and duplicate show slots", () => {
    const d = trialDataset();
    d.shows.push({ ...d.shows[0], id: "other" });
    expect(() => validateDataset(d)).toThrow("重複");
    const e = trialDataset();
    e.entryFacts.push({
      id: "orphan",
      revision: 0,
      showId: e.shows[0].id,
      entryKey: "missing",
      unpublishedBeforeShow: true,
      firstPerformedAtShow: true,
      note: "",
    });
    expect(() => validateDataset(e)).toThrow("孤立");
  });
  it("allows same venue/date with a different slot; import excludes duplicates", () => {
    const d = trialDataset();
    d.shows.push({ ...d.shows[0], id: "matinee", slot: "昼" });
    validateDataset(d);
    expect(importPreview(trialDataset(), d).shows.map((s) => s.id)).toEqual([
      "matinee",
    ]);
  });
  it("merges refs once without changing stable keys or replay facts", () => {
    const d = trialDataset();
    d.releaseTracks = [];
    const next = mergeLocalSong(d, "L:local-to-the-first", "U:9999");
    expect(next.localSongs).toHaveLength(0);
    expect(next.templates[0].entries[16]).toMatchObject({
      id: "entry-17",
      songRef: "U:9999",
    });
    expect(analyze(next, next.shows)).toHaveLength(29);
  });
  it("JSON roundtrip preserves all entities and rejects extra tables and dangling refs", () => {
    const d = trialDataset();
    expect(parseBackup(exportJson(d))).toEqual(d);
    expect(() =>
      validateDataset({ ...d, confirmationStatus: "CONFIRMED" }),
    ).toThrow();
    expect(() => mergeLocalSong(d, "L:local-to-the-first", "L:bad")).toThrow();
  });
});
describe("explicit catalog merge candidates", () => {
  it("normalizes whitespace and case and resolves only verified featured-title aliases", () => {
    const songs = [
      { ...trialSongs[0], ref: "U:1020", title: "Smile again", artist: "BE:FIRST", available: true },
      { ...trialSongs[0], ref: "U:1054", title: "BRUCE WAYNE feat. Flo Milli, ATL Jacob", artist: "BE:FIRST", available: true },
      { ...trialSongs[0], ref: "U:1057", title: "WATCH ME feat. BIA", artist: "BE:FIRST", available: true },
      { ...trialSongs[0], ref: "U:5002", title: "New Chapter", artist: "UNIT", available: true },
    ];
    const locals = [
      { id: "smile", title: " Ｓｍｉｌｅ　Ａｇａｉｎ " },
      { id: "bruce", title: "BRUCE WAYNE" },
      { id: "watch", title: "WATCH ME" },
      { id: "chapter", title: "New Chapter" },
    ];
    expect(mergeCandidates(locals, songs).map(x => [x.localRef, x.universeRef])).toEqual([
      ["L:smile", "U:1020"], ["L:bruce", "U:1054"], ["L:watch", "U:1057"],
    ]);
  });
  it("never offers same-title UNIT tracks or unrelated solo artists", () => {
    const songs = [
      { ...trialSongs[0], ref: "U:5002", title: "New Chapter", artist: "UNIT", available: true },
      { ...trialSongs[0], ref: "U:9991", title: "Want it", artist: "OTHER", available: true },
      { ...trialSongs[0], ref: "U:9992", title: "Want it", artist: "SHUNTO", available: true },
    ];
    expect(mergeCandidates([{ id: "a", title: "New Chapter" }, { id: "b", title: "Want it" }], songs))
      .toEqual([{ localRef: "L:b", universeRef: "U:9992", title: "Want it" }]);
  });
  it("offers same-title candidates without changing either source", () => {
    const songs = [{ ...trialSongs[0], title: "Title" }];
    const locals = [{ id: "local", title: "Title" }];
    expect(mergeCandidates(locals, songs)).toHaveLength(1);
    expect(locals).toHaveLength(1);
    expect(songs[0].ref).toBe(trialSongs[0].ref);
  });
});

it("restore readback tolerates Firestore key/query order but detects entry order changes", () => {
  const data = trialDataset();
  const reverseKeys = (v: any): any => Array.isArray(v) ? v.map(reverseKeys) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).reverse().map(([k,x]) => [k,reverseKeys(x)])) : v;
  const readback = reverseKeys(data);
  readback.shows.reverse();
  expect(canonicalDatasetJson(readback)).toBe(canonicalDatasetJson(data));
  readback.templates[0].entries.reverse();
  expect(canonicalDatasetJson(readback)).not.toBe(canonicalDatasetJson(data));
});
