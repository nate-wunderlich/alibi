# POLISH -- alibi

Friday list: fixes to how things look and read, not new features.

- Landing envelope flap sits off-center and is clipped on the right.
  DONE (D59): the flap is an SVG triangle from both top corners to a centered point; checked at 390px and 1440px.
- Join placeholder says "6-letter code"; codes include digits. Use "6-character code".
  DONE (D59): placeholder reads "6-character code"; no other "6-letter" text in the app.
- The shower's round log could name the card they showed.
  HELD (D59): shown_cards rows are readable only by the guesser (R29), and round.spec asserts the
  shower never receives them, so the shower has no row to read the name from. Needs a ruling.
- Build warns that the client bundle is over Vite's chunk-size line.
  DONE (D59): React and the router split into a client-only react-vendor chunk (311 kB); main chunk 216 kB; no warning.
- Portraits are 1.2-1.7 MB PNGs shown at 64 px (about 6 MB per round on a phone). Check whether openai/generate-image passes output_format/output_compression through (jpeg or webp); otherwise note it as a known edge.
  KNOWN EDGE (D59): one probe with output_format "webp" and output_compression 60 returned image/png,
  1,289,207 bytes; the endpoint's schema has no such fields and ignores them. runPortraits unchanged.
- Opening scene can state a head count that does not match the 4 suspects (e.g. five souls); some credits read awkwardly. Judge in play; fix only if noticeable.
  OPEN: not addressed in D59; still to judge in play.
