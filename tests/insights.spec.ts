import { describe, it, expect } from "vitest";
import { trialDataset } from "../fixtures/dome2024";
import { attendanceStats, prefecture, songArchive } from "../shared/insights";

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
