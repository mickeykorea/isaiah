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
    // console.log('transformer.js loaded.');
})();

// Get initial AI response and follow-up questions
async function getInitialAIResponse(userInput) {
    const response = await fetch(`${openai_api_proxy}/v4/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: 'gpt-3.5-turbo',
            messages: [
                { role: 'system', content: 'You are an AI art curator assistant. Respond with a JSON array of 2-3 follow-up questions, without any markdown formatting.' },
                { role: 'user', content: `Based on the theme "${userInput}", suggest 2-3 follow-up questions to refine the exhibition curation.` }
            ]
        }),
    });
    const data = await response.json();
    console.log('Raw API response:', data);
    try {
        let content = data.choices[0].message.content;

        // Remove any markdown formatting
        content = content.replace(/```json\n?|\n?```/g, '').trim();
        console.log('Cleaned content:', content);

        return JSON.parse(content);
    } catch (error) {
        console.error('Error parsing AI response:', error);
        console.log('Raw AI response:', data.choices[0].message.content);
        // Return a default set of questions if parsing fails
        return [
            "What specific art style or period are you interested in?",
            "Are there any particular artists or cultures you'd like to focus on?",
            "Do you have any preferences for the medium of the artworks (e.g., paintings, sculptures, photographs)?"
        ];
    }
}

// Handle user preferences
function handleUserPreferences(preferences) {
    // Process user preferences and refine the search criteria
    return preferences.reduce((acc, pref) => {
        const [key, value] = pref.split(':');
        acc[key.trim()] = value.trim();
        return acc;
    }, {});
}

// Initiate the conversation
async function initiateConversation(userInput) {
    const chatDiv = document.getElementById('chat-interface');
    chatDiv.innerHTML = '';

    appendMessage(chatDiv, `User: ${userInput}`, 'user');
    appendMessage(chatDiv, "Isaiah: I'm thinking about your theme...", 'ai');

    try {
        const followUpQuestions = await getInitialAIResponse(userInput);
        appendMessage(chatDiv, "Isaiah: To better understand your theme, could you answer these questions:", 'ai');

        const preferences = await displayFollowUpQuestions(followUpQuestions);
        const refinedCriteria = handleUserPreferences(preferences);

        appendMessage(chatDiv, "Isaiah: Great! I'll curate an exhibition based on your preferences.", 'ai');
        // await curateExhibition(refinedCriteria);
        await curateExhibition({ ...refinedCriteria, initialInput: userInput });
    } catch (error) {
        console.error('Error in conversation:', error);
        appendMessage(chatDiv, "Isaiah: I'm sorry, but I encountered an error while processing your request.", 'ai');
    }
}

// Display follow-up questions and get user preferences
async function displayFollowUpQuestions(questions) {
    const chatDiv = document.getElementById('chat-interface');
    const preferences = [];

    for (const question of questions) {
        appendMessage(chatDiv, question, 'ai');
        const answer = await getUserInput();
        appendMessage(chatDiv, `User: ${answer}`, 'user');
        preferences.push(`${question}: ${answer}`);
    }

    return preferences;
}

// Helper function to get user input
function getUserInput() {
    return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'text';
        const button = document.createElement('button');
        button.textContent = 'Submit';

        const inputContainer = document.createElement('div');
        inputContainer.appendChild(input);
        inputContainer.appendChild(button);

        document.getElementById('chat-interface').appendChild(inputContainer);

        button.onclick = () => {
            const value = input.value;
            inputContainer.remove();
            resolve(value);
        };
    });
}

// Pass the keywords to the MET API and display the artworks
async function curateExhibition(criteria) {
    const apiUrl = museumAPIs['met'];
    const keywords = Object.values(criteria).join(' ');

    //end point for MET : Search
    const searchUrl = `${apiUrl}/search?q=${encodeURIComponent(keywords)}`;
    console.log('Keywords passed to MET:', keywords);
    console.log('Search URL:', searchUrl);

    try {
        const response = await fetch(searchUrl);
        const data = await response.json();

        if (data.total > 0) {
            const objectIds = data.objectIDs.slice(0, 10);
            const artworks = await fetchArtworks(objectIds);
            const selectedArtworks = selectArtworks(artworks, criteria);
            displayArtworks(selectedArtworks);
        } else {
            console.log('No results found for the given criteria');
        }
    } catch (error) {
        console.error('Error fetching artworks:', error);
    }
}

//select artworks based on multiple criteria
function selectArtworks(artworks, criteria) {
    // Implement artwork selection logic based on the criteria
    // SELCTION CRITERIA GOES HERE!!!
    return artworks.slice(0, 4);
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
                imageUrl: artworkData.primaryImage || '',
                medium: artworkData.medium || '',
                department: artworkData.department || ''
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
    artworksDisplay.innerHTML = '';

    artworks.forEach((artwork) => {
        const artElement = document.createElement('div');
        artElement.className = 'artwork';
        artElement.innerHTML = `
            <h3>${artwork.title}</h3>
            ${artwork.year ? `<p>Year: ${artwork.year}</p>` : ''}
            ${artwork.artist ? `<p>Artist: ${artwork.artist}</p>` : ''}
            ${artwork.medium ? `<p>Medium: ${artwork.medium}</p>` : ''}
            ${artwork.department ? `<p>Department: ${artwork.department}</p>` : ''}
            <img src="${artwork.imageUrl}" alt="${artwork.title}" width="200">
        `;
        artworksDisplay.appendChild(artElement);
    });
}

// Helper function to append messages to the chat interface
function appendMessage(chatDiv, message, sender) {
    const messageElement = document.createElement('p');
    messageElement.textContent = message;
    messageElement.className = sender;
    chatDiv.appendChild(messageElement);
}

// Event listener for the submit button
document.getElementById('submit-button').addEventListener('click', async () => {
    const themeInput = document.getElementById('theme-input').value;
    if (themeInput) {
        await initiateConversation(themeInput);
    } else {
        alert('Please enter a theme for the exhibition.');
    }
});