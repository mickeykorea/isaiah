const fs = require('fs');
const csv = require('csv-parser');

// Input and output file paths
const inputFile = './met.csv';
const outputFile = './met.txt';

// Fields to extract from the CSV
const fieldsToExtract = [
    'Object ID',
    'Object Name',
    'Title',
    'Artist Display Name',
    'Object Begin Date',
    'Medium',
    'Tags'
];

// Array to store text chunks
const chunks = [];

// Function to read the CSV and process it
fs.createReadStream(inputFile)
    .pipe(csv())
    .on('data', (row) => {
        const chunk = fieldsToExtract
            .map((field) => row[field]?.trim()) // Extract and trim field values
            .filter((value) => value) // Ignore empty fields
            .join(' | '); // Join non-empty fields with delimiter

        if (chunk) {
            chunks.push(chunk);
        }
    })
    .on('end', () => {
        fs.writeFileSync(outputFile, chunks.join('\n'), 'utf-8');
        console.log(`Processed ${chunks.length} entries and saved to ${outputFile}`);
    })
    .on('error', (error) => {
        console.error('Error:', error);
    });
