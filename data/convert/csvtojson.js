import fs from 'fs';
import csv from 'csv-parser';

function csvToJson(csvFilePath, jsonFilePath) {
    const results = [];

    fs.createReadStream(csvFilePath)
        .pipe(csv())
        .on('data', (data) => results.push(data))
        .on('end', () => {
            fs.writeFileSync(jsonFilePath, JSON.stringify(results, null, 2), 'utf-8');
            console.log('CSV file successfully converted to JSON format.');
        });
}

// Example usage
csvToJson('../met-art.csv', 'met.json');