import { describe, it, expect } from "vitest";
import { trialDataset } from "../fixtures/dome2024";
import { attendanceStats, prefecture, songArchive, selectAttendancePeriod, JAPAN_PREFECTURE_LAYOUT } from "../shared/insights";

describe("BE:LIVE insights", () => {
  it("normalizes only identifiable prefectures", () => {
    expect(prefecture("東京")).toBe("東京都");
    expect(prefecture("大阪府")).toBe("大阪府");
    expect(prefecture("愛知")).toBe("愛知県");
    expect(prefecture("関東")).toBeNull();
    expect(prefecture("名古屋")).toBeNull();
  });
  it("counts attended shows even when their setlist is unknown", () => {
    const data = trialDataset();
    const stats = attendanceStats(data, [data.shows[0], data.shows[1]]);
    expect(stats.total).toBe(2);
    expect(stats.prefectures).toEqual([["東京都", 2]]);
    expect(stats.tourStats[0]).toMatchObject({ attended: 2, total: 4, rate: 0.5 });
  });
  it("defaults to the newest attended year, not the current calendar year", () => {
    const data = trialDataset();
    const older = data.shows[0];
    const newer = {...data.shows[1], id: "future-show", date: "2028-02-01", region: "大阪"};
    data.shows.push(newer);
    const view = selectAttendancePeriod(data, [older, newer], null);
    expect(view.years).toEqual(["2028", "2024"]);
    expect(view.period).toBe("2028");
    expect(view.stats.total).toBe(1);
    expect(view.stats.prefectures).toEqual([["大阪府", 1]]);
    expect(selectAttendancePeriod(data, [older, newer], "2024").stats.total).toBe(1);
    expect(selectAttendancePeriod(data, [older, newer], "all").stats.total).toBe(2);
    expect(selectAttendancePeriod(data, [older, newer], "2027").period).toBe("2028");
  });
  it("scopes tour attendance denominator to registered shows in the selected year", () => {
    const data = trialDataset();
    const future = {...data.shows[0], id:"future-tour", date:"2027-05-01"};
    data.shows.push(future);
    const yearView = selectAttendancePeriod(data, [future], "2027");
    expect(yearView.stats.tourStats[0]).toMatchObject({attended:1,total:1,rate:1});
    expect(yearView.allStats.tourStats[0]).toMatchObject({attended:1,total:5,rate:0.2});
  });
  it("handles no attendance without inventing a year", () => {
    const view = selectAttendancePeriod(trialDataset(), [], null);
    expect(view.years).toEqual([]);
    expect(view.period).toBe("all");
    expect(view.stats.total).toBe(0);
  });
  it("has a unique position for every prefecture in the schematic travel map", () => {
    const names = JAPAN_PREFECTURE_LAYOUT.map(([name]) => name);
    const positions = JAPAN_PREFECTURE_LAYOUT.map(([,col,row]) => col + ":" + row);
    expect(names).toHaveLength(47);
    expect(new Set(names).size).toBe(47);
    expect(new Set(positions).size).toBe(47);
    expect(names.every(name => prefecture(name) !== null)).toBe(true);
    expect(JAPAN_PREFECTURE_LAYOUT.every(([,col,row]) => col >= 1 && col <= 11 && row >= 1 && row <= 19)).toBe(true);
  });
  it("provides tour details with both attended and not-attended registered shows", () => {
    const data = trialDataset();
    const stats = attendanceStats(data, [data.shows[1]]);
    expect(stats.tourStats[0].shows).toHaveLength(4);
    expect(stats.tourStats[0].shows.filter(s => s.attended).map(s => s.id)).toEqual([data.shows[1].id]);
    expect(stats.tourStats[0].rate).toBe(0.25);
  });
  it("filters the travel-map source to the selected year without changing all-period data", () => {
    const data = trialDataset();
    const older = data.shows[0];
    const newer = {...data.shows[1], id:"another-year", date:"2027-06-10", region:"大阪"};
    data.shows.push(newer);
    const mine = [older, newer];
    const year = selectAttendancePeriod(data, mine, "2027");
    expect(year.shows.map(s => s.id)).toEqual(["another-year"]);
    expect(year.stats.prefectures).toEqual([["大阪府",1]]);
    expect(year.allStats.prefectures).toEqual([["大阪府",1],["東京都",1]]);
    expect(selectAttendancePeriod(data, mine, "all").shows).toHaveLength(2);
  });
  it("does not guess a prefecture from a city or unknown region", () => {
    const data = trialDataset();
    const show = {...data.shows[0], region:"名古屋"};
    const stats = attendanceStats(data, [show]);
    expect(stats.unknownPrefectures).toBe(1);
    expect(stats.prefectures).toEqual([]);
  });
  it("does not count an arranged game as a song archive performance", () => {
    const d = trialDataset();
    const base = d.templates[0].entries[0];
    d.templates[0].entries.push({ ...base, id: "game-entry", songRef: "U:1023", arrangement: "ARRANGED", note: "歌割り変更ゲーム", countsAsPerformance: false });
    const a = songArchive(d, d.shows, "U:1023");
    expect(a.performances).toBe(1);
    expect(a.shows).toBe(1);
    expect(a.history.some(h => h.entry.id === "game-entry")).toBe(false);
  });
  it("uses only saved setlists as the performance-rate denominator", () => {
    const data = trialDataset();
    const archive = songArchive(data, data.shows, "U:1023");
    expect(archive.knownShows).toBe(1);
    expect(archive.shows).toBe(1);
    expect(archive.performances).toBe(1);
    expect(archive.rate).toBe(1);
    expect(archive.first).toBe("2024-03-03");
    expect(archive.last).toBe("2024-03-03");
  });
});
