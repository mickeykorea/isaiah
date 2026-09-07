// One-off: pack the JSON embedding files (produced by embedding.js) into raw Float32 (little-endian) binaries.
// 38 MB of JSON -> 5.5 MB of .bin, loaded in the browser with `new Float32Array(await res.arrayBuffer())`.
// The JSON sources are not committed; regenerate them with embedding.js first if you need to re-pack.
import { readFileSync, writeFileSync } from 'fs';
import assert from 'assert';

const DIM = 384;

function pack(jsonPath, binPath) {
    const items = JSON.parse(readFileSync(jsonPath, 'utf8'));
    const out = new Float32Array(items.length * DIM);
    items.forEach((item, i) => {
        assert.equal(item.embedding.length, DIM, `bad dim at ${i}`);
        out.set(item.embedding, i * DIM);
    });
    writeFileSync(binPath, Buffer.from(out.buffer));
    // self-check: round-trip and compare a dot product against the JSON source
    const back = new Float32Array(readFileSync(binPath).buffer.slice(0));
    assert.equal(back.length, items.length * DIM);
    const last = items.length - 1;
    let dot = 0;
    for (let d = 0; d < DIM; d++) dot += back[last * DIM + d] * items[last].embedding[d];
    assert(Math.abs(dot - 1) < 1e-4, 'round-trip mismatch (vectors should be unit length)');
    console.log(`${binPath}: ${items.length} vectors, ${(out.byteLength / 1e6).toFixed(1)} MB`);
}

pack('../artpedia_embeddings.json', '../artpedia_embeddings.bin');
pack('../met_embeddings.json', '../met_embeddings.bin');
