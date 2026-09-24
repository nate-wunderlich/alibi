# POLISH -- alibi

Friday list: fixes to how things look and read, not new features.

- Landing envelope flap sits off-center and is clipped on the right.
- Join placeholder says "6-letter code"; codes include digits. Use "6-character code".
- The shower's round log could name the card they showed.
- Build warns that the client bundle is over Vite's chunk-size line.
- Portraits are 1.2-1.7 MB PNGs shown at 64 px (about 6 MB per round on a phone). Check whether openai/generate-image passes output_format/output_compression through (jpeg or webp); otherwise note it as a known edge.
- Opening scene can state a head count that does not match the 4 suspects (e.g. five souls); some credits read awkwardly. Judge in play; fix only if noticeable.
