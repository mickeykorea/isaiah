import * as fs from 'fs';
import { pipeline } from '@xenova/transformers';

//console.log("Module loaded successfully");

// Load the embeddings model
const extractor = await pipeline('feature-extraction', 'Xenova/bge-small-en-v1.5');

// Read the input file and split it into chunks
console.log('Reading source file...');
const raw = fs.readFileSync('./data/met/met.txt', 'utf-8');
let chunks = raw.split(/\n+/).map(chunk => chunk.trim()).filter(chunk => chunk !== '');
console.log(`Total chunks to process: ${chunks.length}`);

// Define output file
const outputFile = 'metEmbeddings-test.json';

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
    const batchData = batch.filter(result => result !== null); // Remove failed chunks
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

        break; // TEST ONE BATCH
    }

    // Close the JSON array properly
    fs.appendFileSync(outputFile, ']\n', 'utf-8');
}

// Start processing in batches of 1000 chunks
processInBatches(1000)
    .then(() => console.log('Processing complete!'))
    .catch(err => console.error('Error during processing:', err));