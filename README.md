# Isaiah · AI Curation Model

AI curation model designed to curate art exhibitions by analyzing visual and textual data to support curatorial decision-making and provide thematic groupings of artworks.

---

### Description

Based on extensive artworks and metadata datasets, it helps human curators uncover hidden correlations between artworks during the curatorial decision-making process. Also, built to bridge the gap between curators and the general public, Isaiah democratizes art appreciation by using AI to provide personalized exhibitions, allowing audiences to participate in curation regardless of their background in art knowledge.

---

Capstone Project for B.S. in Interactive Media Arts

---

### How it runs

Static site (GitHub Pages, `isaiahcurate.net`). Everything happens in the browser:

1. `Xenova/bge-small-en-v1.5` (Transformers.js) embeds the theme + interview answers.
2. Dot product against precomputed embeddings for 2,930 Artpedia + 670 MET works (`data/*.bin`, Float32), top 20 kept.
3. One chat-completion call selects 4 works and writes the title, curator's note, artist and wall text.

OpenAI calls go through the Cloudflare Worker in `worker/`, which holds the API key and pins the model (`gpt-5.4-nano`, chosen for latency at the same price as gpt-5.6-luna).

```bash
# local preview: any static server, e.g.
npx serve .

# deploy the proxy (model + output cap are set in worker/index.js)
cd worker && wrangler deploy
wrangler secret put OPENAI_API_KEY
```

Regenerating embeddings: `data/convert/embedding.js` writes JSON, `data/convert/pack-embeddings.js` packs it to `.bin`.
