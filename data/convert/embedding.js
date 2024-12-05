import * as fs from 'fs';
import { pipeline } from '@xenova/transformers';

// Load the embeddings model
const extractor = await pipeline('feature-extraction', 'Xenova/bge-small-en-v1.5');

// Read and parse the JSON file
console.log('Reading source file...');
const rawData = JSON.parse(fs.readFileSync('../met.json', 'utf-8'));

// Process each artwork entry into a text chunk
const chunks = Object.entries(rawData).map(([id, artwork]) => {
    // Combine relevant text fields
    const textParts = [
        artwork.title,
        `Year: ${artwork.year}`,
        ...(artwork.visual_sentences || []),
        ...(artwork.contextual_sentences || [])
    ];

    // Join all parts with proper spacing
    return textParts.join(' ').trim();
});

console.log(`Total artworks to process: ${chunks.length}`);

// Define output file
const outputFile = '../met_embeddings.json';

// Helper function to process a single chunk
async function processChunk(chunk) {
    try {
        const output = await extractor(chunk, { pooling: 'mean', normalize: true });
        const embedding = output.tolist()[0];
        return { text: chunk, embedding };
    } catch (error) {
        console.error('Error processing chunk:', error);
        return null;
    }
}

// Write each batch incrementally to the file
async function writeBatchToFile(batch, isLastBatch) {
    const batchData = batch.filter(result => result !== null);
    let jsonString = JSON.stringify(batchData, null, 2);

    // Remove the opening and closing brackets
    jsonString = jsonString.slice(1, -1);

    // Remove the trailing comma from the last item if it's the last batch
    if (isLastBatch) {
        jsonString = jsonString.replace(/,\s*$/, '');
    }

    // Append the batch to the file
    fs.appendFileSync(outputFile, jsonString + (isLastBatch ? '' : ',') + '\n', 'utf-8');
}

// Process data in manageable batches
async function processInBatches(batchSize) {
    // Initialize the output file with an opening bracket
    fs.writeFileSync(outputFile, '[\n', 'utf-8');

    const totalBatches = Math.ceil(chunks.length / batchSize);

    for (let i = 0; i < chunks.length; i += batchSize) {
        const currentBatch = Math.floor(i / batchSize) + 1;
        console.log(`Processing batch ${currentBatch} of ${totalBatches}`);
        const batch = chunks.slice(i, i + batchSize);

        const results = await Promise.all(batch.map(processChunk));
        const isLastBatch = currentBatch === totalBatches;
        await writeBatchToFile(results, isLastBatch);
    }

    // Close the JSON array properly
    fs.appendFileSync(outputFile, ']\n', 'utf-8');
}

// Start processing in batches of 100 chunks
processInBatches(100)
    .then(() => console.log('Processing complete!'))
    .catch(err => console.error('Error during processing:', err));