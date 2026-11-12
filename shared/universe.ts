import type { Song } from "./model.js";

/** Only known BE:FIRST alternate credits may be resolved by an explicit ID. */
const verifiedAliases: Record<string, string> = {
  "brucewayne": "U:1054",
  "watchme": "U:1057",
};
const soloArtists: Record<string, string> = {
  "wantit": "SHUNTO",
  "rainonme": "MANATO",
  "loop": "RYUHEI",
  "novaflame": "JUNON",
  "chillwithyou": "SOTA",
  "ijustwannabemyself": "LEO",
};
const titleKey = (s: string) => s.normalize("NFKC")
  .replace(/[’‘]/g, "'")
  .replace(/\s+/g, "")
  .toLocaleLowerCase();
const artistMatches = (key: string, artist: string | null) =>
  artist === "BE:FIRST" || (soloArtists[key] !== undefined && artist === soloArtists[key]);

/** Suggest verified title aliases; never silently merge unrelated artists or UNIT tracks. */
export const mergeCandidates = (
  locals: { id: string; title: string }[],
  songs: Song[],
) =>
  locals.flatMap(l => {
    const key = titleKey(l.title);
    return songs
      .filter(s =>
        s.available && artistMatches(key, s.artist) &&
        (titleKey(s.title) === key || verifiedAliases[key] === s.ref),
      )
      .map(s => ({
        localRef: "L:" + l.id,
        universeRef: s.ref,
        title: s.title,
      }));
  });
