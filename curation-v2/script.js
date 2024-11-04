// Define API keys and endpoints
const openai_api_proxy = "https://open-ai-proxy.glitch.me/";

const museumAPIs = {
    // 'moma': 'https://api.moma.org/collection',
    'met': 'https://collectionapi.metmuseum.org/public/collection/v1/',
    // 'gac': 'https://your-google-arts-culture-api-endpoint'
};

// transformer.js
// import { pipeline } from '@xenova/transformers';
import { pipeline } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/transformers.min.js';

let extractor;
(async () => {
    extractor = await pipeline('feature-extraction', 'Xenova/bge-small-en-v1.5');
    console.log('transformer.js loaded.');
})();

// Function to convert user input into an embedding
async function getUserEmbedding(userInput) {
    const output = await extractor(userInput, { pooling: 'mean', normalize: true });
    return output.tolist()[0]; // Return the user input embedding as an array
}

// Store MET embeddings data
let metEmbeddings = [];

// Load embeddings from metEmbeddings json file
async function loadMuseumEmbeddings() {
    try {
        const response = await fetch('metEmbeddings-test.json');
        if (!response.ok) {
            throw new Error(`HTTP error, status: ${response.status}`);
        }

        const data = await response.json();
        metEmbeddings = data.map(item => ({
            ...item,
            combinedText: `${item.title} ${item.artist} ${item.medium}`.toLowerCase()
        }));
        console.log(`Loaded ${metEmbeddings.length} embeddings.`);
    } catch (error) {
        console.error('Error loading embeddings:', error);
        alert('Failed to load embeddings. Please check the console for more information.');
    }
}

// Caculate Cosine similarity
function cosineSimilarity(vecA, vecB) {
    const dotProduct = vecA.reduce((acc, val, i) => acc + val * vecB[i], 0);
    const normA = Math.sqrt(vecA.reduce((acc, val) => acc + val ** 2, 0));
    const normB = Math.sqrt(vecB.reduce((acc, val) => acc + val ** 2, 0));
    return dotProduct / (normA * normB);
}

// Get the most relevant keywords based on user input
async function getRelevantKeywords(userInput) {
    const userEmbedding = await getUserEmbedding(userInput);

    const similarities = metEmbeddings.map((obj) => ({
        text: obj.text,
        combinedText: obj.combinedText,
        similarity: cosineSimilarity(userEmbedding, obj.embedding),
    }));

    // Sort by similarity in descending order
    similarities.sort((a, b) => b.similarity - a.similarity);

    // Return the top 20 most relevant keywords
    return similarities.slice(0, 20);
}

// Refine keywords
function getRefinedKeywords(keywords) {
    const uniqueKeywords = [...new Set(keywords.map(k => k.text))];
    return uniqueKeywords.slice(0, 10);
}
// // Generate embedding for user input using OpenAI API — no longer used bc now gets embedding from transformer.js
// async function getEmbedding(userInput) {
//     const response = await fetch(`${openai_api_proxy}/v1/embeddings`, {
//         method: 'POST',
//         headers: { 'Content-Type': 'application/json' },
//         body: JSON.stringify({
//             model: 'text-embedding-ada-002',
//             input: userInput,
//         }),
//     });
//     const data = await response.json();
//     return data.data[0].embedding;
// }

// Compare user input with MET embeddings and find top keywords
// async function getRelevantKeywords(userInput) {
//     const userEmbedding = await getEmbedding(userInput);
//     console.log(userEmbedding);
//     const similarities = metEmbeddings.map((obj) => ({
//         text: obj.text,
//         similarity: cosineSimilarity(userEmbedding, obj.embedding),
//     }));
//     similarities.sort((a, b) => b.similarity - a.similarity); // Sort by similarity score
//     return similarities.slice(0, 5).map((item) => item.text); // Top 5 keywords
// }

document.getElementById('submit-button').addEventListener('click', async () => {
    const themeInput = document.getElementById('theme-input').value;

    if (themeInput) {
        // Hide existing sections
        document.getElementById('chat-interface').innerHTML = '';
        document.getElementById('keyword-options').style.display = 'none';
        document.getElementById('exhibition-section').style.display = 'none';

        const keywords = await getRelevantKeywords(themeInput);
        const refinedKeywords = getRefinedKeywords(keywords);
        initiateConversation(themeInput, refinedKeywords);
    } else {
        alert('Please enter a theme for the exhibition.');
    }
});

// Initiate the conversation
function initiateConversation(userInput, keywords) {
    const chatDiv = document.getElementById('chat-interface');
    chatDiv.innerHTML = '';

    const userMessage = document.createElement('p');
    userMessage.textContent = `User: ${userInput}`;
    chatDiv.appendChild(userMessage);

    setTimeout(() => {
        const aiMessage = document.createElement('p');
        aiMessage.textContent = "Isaiah: I'm thinking about your theme...";
        chatDiv.appendChild(aiMessage);

        setTimeout(() => {
            aiMessage.innerHTML = `Isaiah: I found relevant tags such as:<br><br>
${keywords.join('<br>')}
<br><br>Which one best reflects your desired theme?`;
            displayKeywordOptions(keywords);
        }, 5000);
    }, 1000);
}

function displayKeywordOptions(keywords) {
    const optionsDiv = document.getElementById('keyword-options');
    optionsDiv.innerHTML = ''; // Clear previous options

    const uniqueDisplayTexts = new Set();

    keywords.forEach((keyword) => {
        // Split the keyword string and extract the 2nd and 3rd elements
        const parts = keyword.split('|').map(part => part.trim());
        let displayText;
        let fullKeyword;

        // Check if the 2nd and 3rd elements are the same
        if (parts[1] === parts[2]) {
            displayText = parts[1];
        } else {
            displayText = `${parts[1]}, ${parts[2]}`;
        }

        // Create the full keyword without number parts
        fullKeyword = parts.filter(part => isNaN(Number(part)));

        // Only create a button if this displayText is unique
        if (!uniqueDisplayTexts.has(displayText.toLowerCase())) {
            uniqueDisplayTexts.add(displayText.toLowerCase());

            const button = document.createElement('button');
            button.textContent = displayText;
            button.addEventListener('click', () => {
                const chatDiv = document.getElementById('chat-interface');
                const userChoice = document.createElement('p');
                userChoice.textContent = `User: "${displayText}"`;
                chatDiv.appendChild(userChoice);

                setTimeout(() => {
                    const aiResponse = document.createElement('p');
                    aiResponse.textContent = `AI: I'll curate an exhibition based on "${displayText}".`;
                    chatDiv.appendChild(aiResponse);
                    curateExhibition(fullKeyword);
                }, 1000);
            });
            optionsDiv.appendChild(button);
        }
    });

    optionsDiv.style.display = 'block'; // Show the options section
}

// Fetch and curate exhibition based on selected keyword
async function curateExhibition(keyword) {
    const apiUrl = museumAPIs['met'];
    // const searchUrl = `${apiUrl}/search?tags=true&q=${encodeURIComponent(keyword)}`;
    const searchUrl = `${apiUrl}/search?q=${encodeURIComponent(keyword)}`;

    console.log('Keyword passed to MET API:', keyword);
    console.log('Search URL:', searchUrl);

    try {
        const response = await fetch(searchUrl);
        const data = await response.json();

        if (data.total > 0) {
            const objectIds = data.objectIDs.slice(0, 4); // Limit to 4 artworks > this part needs to be changed to using OPEN AI API 
            const artworks = await fetchArtworks(objectIds);
            displayArtworks(artworks);
        } else {
            console.log(`No results found for keyword "${keyword}"`);
        }
    } catch (error) {
        console.error(`Error fetching artworks for keyword "${keyword}":`, error);
    }
}

// Fetch artwork details from the MET API
async function fetchArtworks(objectIds) {
    const apiUrl = museumAPIs['met'];
    const artworks = [];

    for (const objectId of objectIds) {
        try {
            const response = await fetch(`${apiUrl}/objects/${objectId}`);
            const artworkData = await response.json();

            artworks.push({
                title: artworkData.title || 'Untitled',
                artist: artworkData.artistDisplayName || '',
                year: artworkData.objectDate || '',
                imageUrl: artworkData.primaryImage || ''
            });
        } catch (error) {
            console.error(`Error fetching artwork details for ID ${objectId}:`, error);
        }
    }

    return artworks;
}

// Display artworks on the web
function displayArtworks(artworks) {
    const exhibitionSection = document.getElementById('exhibition-section');
    exhibitionSection.style.display = 'block';
    const artworksDisplay = document.getElementById('artworks-display');
    artworksDisplay.innerHTML = ''; // Clear previous artworks

    artworks.forEach((artwork) => {
        const artElement = document.createElement('div');
        artElement.className = 'artwork';
        artElement.innerHTML = `
            <h3>${artwork.title}</h3>
            ${artwork.year ? `<p>${artwork.year}</p>` : ''}
            ${artwork.artist ? `<p>${artwork.artist}</p>` : ''}
            <img src="${artwork.imageUrl}" alt="${artwork.title}" width="200">
        `;
        artworksDisplay.appendChild(artElement);
    });
}

// Load embeddings on page load
window.onload = loadMuseumEmbeddings;