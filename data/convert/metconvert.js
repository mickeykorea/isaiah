// the original met.json file I downloaded from kaggle only included the link to the MET website, which wasn't what I needed.
// I needed the direct image link that gives the image itself.
// This script takes the webpage link from the original met.json and uses the MET API to get the direct image link (primaryImage endpoint)
// It also adds the year attribute to the json file

import { readFileSync, writeFileSync } from 'fs';
import fetch from 'node-fetch';

// Load the JSON data
const metData = JSON.parse(readFileSync('../met.json', 'utf8'));

// MET API base URL
const metApiBaseUrl = 'https://collectionapi.metmuseum.org/public/collection/v1/objects/';

// Function to add year attribute
async function addYearAttribute() {
    for (let item of metData) {
        if (item.img_url) {
            // Extract object ID from the original MET URL
            const objectId = item.img_url.split('/').pop();

            try {
                // Fetch object details from MET API
                const response = await fetch(`${metApiBaseUrl}${objectId}`);
                const data = await response.json();

                // Check if data and objectBeginDate are defined
                if (data && data.objectBeginDate) {
                    console.log(`Title: ${item.title}, Begin Date: ${data.objectBeginDate}`);
                    // Directly assign objectBeginDate to year
                    item.year = data.objectBeginDate;
                    console.log(`Year added: ${item.year}`);
                } else {
                    console.log(`Title: ${item.title}, Begin Date: not found`);
                }
            } catch (error) {
                console.error(`Error fetching data for object ID ${objectId}:`, error);
            }
        }
    }

    // Write the updated data back to the JSON file
    writeFileSync('../met.json', JSON.stringify(metData, null, 2));
    console.log('Year attributes added successfully.');
}

// Function to update img_url with primaryImage
async function updateImageUrls() {
    for (let item of metData) {
        if (item.img_url) {
            // Extract object ID from img_url
            const objectId = item.img_url.split('/').pop();

            try {
                // Fetch object details from MET API
                const response = await fetch(`${metApiBaseUrl}${objectId}`);
                const data = await response.json();

                // Update img_url with primaryImage
                if (data.primaryImage) {
                    item.img_url = data.primaryImage;
                }
            } catch (error) {
                console.error(`Error fetching data for object ID ${objectId}:`, error);
            }
        }
    }

    // Write the updated data back to the JSON file
    writeFileSync('../met.json', JSON.stringify(metData, null, 2));
    console.log('Image URLs updated successfully.');
}

// Function to filter out objects with search endpoint URLs
function filterObjects() {
    // Filter out objects where img_url contains the search endpoint
    const filteredData = metData.filter(item => !item.img_url.includes('https://www.metmuseum.org/art/collection/search'));

    // Write the filtered data back to the JSON file
    writeFileSync('../met.json', JSON.stringify(filteredData, null, 2));
    console.log(`Filtered out objects with search endpoint URLs. Remaining objects: ${filteredData.length}`);
}

// Run the update function
// updateImageUrls();
// addYearAttribute();
filterObjects();