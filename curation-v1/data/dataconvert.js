const csv = require('csvtojson');
const fs = require('fs');

// Convert CSV to JSON
// node your_file_name.js
csv()
    .fromFile('moma/artists.csv')
    .then((jsonObj) => {
        // Write JSON to a file
        fs.writeFileSync('output.json', JSON.stringify(jsonObj, null, 4));
    });

// Read the TXT file
// node your_file_name.js
// fs.readFile('met/MetObjects.txt', 'utf8', (err, data) => {
//     if (err) throw err;

//     // Example: Convert lines to JSON (assuming 'key:value' per line)
//     const jsonData = {};
//     const lines = data.split('\n');

//     lines.forEach(line => {
//         const [key, value] = line.split(':');
//         if (key && value) {
//             jsonData[key.trim()] = value.trim();
//         }
//     });

//     // Write the JSON data to a file
//     fs.writeFileSync('output.json', JSON.stringify(jsonData, null, 4));
// });