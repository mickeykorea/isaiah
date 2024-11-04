// Define API keys and endpoints
const openai_api_proxy = "https://open-ai-proxy.glitch.me/";

const museumAPIs = {
    // 'moma': 'https://api.moma.org/collection',
    'met': 'https://collectionapi.metmuseum.org/public/collection/v1/',
    // 'gac': 'https://your-google-arts-culture-api-endpoint'
};

// Handle user input and fetch AI theme generation
document.getElementById('submit-button').addEventListener('click', () => {
    const themeInput = document.getElementById('theme-input').value;

    if (themeInput) {
        generateTheme(themeInput).then((themeKeywords) => {
            // Use the generated keywords to fetch artworks from museum APIs
            curateExhibition(themeKeywords);
            // Empty the value of the text input box
            document.getElementById('theme-input').value = '';
        });
    } else {
        alert('Please enter a theme for the exhibition.');
    }
});

// Send the user input to OpenAI API to generate a refined theme for the exhibition
async function generateTheme(userInput) {
    try {
        const response = await requestOAI('POST', '/v1/chat/completions', {
            model: 'gpt-3.5-turbo',
            messages: [
                { role: 'system', content: 'You are an art curator expert.' },
                {
                    role: 'user', content: `The user wants to create an art exhibition based on the theme: "${userInput}". 
                Generate a few keywords to represent this theme. In your response, do not include what I asked for and numbers, simply tell me: the keywords.` }
            ]
        });

        // console.log('Response from OpenAI:', response);
        let themeKeywords = response.choices[0].message.content;
        themeKeywords = themeKeywords.split(',').map(keyword => keyword.trim());
        return themeKeywords;

    } catch (error) {
        console.error('Error generating theme keywords:', error);
    }
}

async function curateExhibition(keywords) {
    const artworks = [];
    console.log('Curating exhibition with keywords:', keywords);

    const museum = 'met';
    const apiUrl = museumAPIs[museum];
    const searchUrl = `${apiUrl}/search`;

    let allObjectIds = [];

    for (const keyword of keywords) {
        try {
            //MET API search with tags
            //https://stackoverflow.com/questions/71682958/using-the-metropolitan-museum-api-tags-parameter
            const response = await fetch(`${searchUrl}?tags=true&q=${encodeURIComponent(keyword)}`);
            const data = await response.json();
            console.log(`Data received from ${museum} API for keyword "${keyword}":`, data);

            if (data.total > 0) {
                allObjectIds = allObjectIds.concat(data.objectIDs);
                console.log(`Added ${data.objectIDs.length} object IDs for keyword "${keyword}"`);
                const exhibitionTitle = document.getElementById('exhibition-title');
                exhibitionTitle.textContent = `${keyword}`;
            } else {
                console.log(`No results found for keyword "${keyword}"`);
            }
        } catch (error) {
            console.error(`Error fetching from ${museum} API for keyword "${keyword}":`, error);
        }
    }

    console.log('All object IDs:', allObjectIds);

    // Shuffle the array of object IDs to get a random selection
    // Later, rather than randomize, it needs to be ask OPEN AI API to select 4 artworks from the array 
    // based on the relationship between the artworks
    allObjectIds = allObjectIds.sort(() => 0.5 - Math.random());

    // Fetch details for up to 4 artworks
    for (const objectId of allObjectIds.slice(0, 4)) {
        try {
            const response = await fetch(`${apiUrl}/objects/${objectId}`);
            const artworkData = await response.json();
            console.log('Artwork data:', artworkData);

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

    console.log('Final curated artworks:', artworks);

    // Display the curated artworks on the web page
    displayArtworks(artworks);
}

// Display artworks on the web
function displayArtworks(artworks) {
    const exhibitionSection = document.getElementById('exhibition-section');
    exhibitionSection.style.display = 'block';
    const artworksDisplay = document.getElementById('artworks-display');
    artworksDisplay.innerHTML = ''; // Clear previous artworks

    artworks.forEach(artwork => {
        const artElement = document.createElement('div');
        artElement.className = 'artwork';
        artElement.innerHTML = `
            <h3>${artwork.title}</h3>
            ${artwork.year !== 'n.d.' ? `<p>${artwork.year}</p>` : ''}
            ${artwork.artist ? `<p>${artwork.artist}</p>` : ''}
            <img src="${artwork.imageUrl}" alt="${artwork.title}" width="200">
        `;
        artworksDisplay.appendChild(artElement);
    });
}
