import type { Song } from "./model.js";
export const mergeCandidates = (
  locals: { id: string; title: string }[],
  songs: Song[],
) =>
  locals.flatMap((l) =>
    songs
      .filter(
        (s) =>
          s.available &&
          s.title.normalize("NFKC").toLocaleLowerCase() ===
            l.title.normalize("NFKC").toLocaleLowerCase(),
      )
      .map((s) => ({
        localRef: "L:" + l.id,
        universeRef: s.ref,
        title: s.title,
      })),
  );
