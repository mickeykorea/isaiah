// Define API keys and endpoints
const openai_api_proxy = "https://open-ai-proxy.glitch.me/";

const museumAPIs = {
    'met': 'https://collectionapi.metmuseum.org/public/collection/v1/',
};

// transformer.js
// import { pipeline } from '@xenova/transformers';
import { pipeline } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/transformers.min.js';

let extractor;
(async () => {
    extractor = await pipeline('feature-extraction', 'Xenova/bge-small-en-v1.5');
    // console.log('transformer.js loaded.');
})();

// Function to convert user input into an embedding
async function getUserEmbedding(userInput, question = '') {
    let textToEmbed = userInput;

    // If input is yes/no, include the question for context
    if (userInput.toLowerCase() === 'yes' || userInput.toLowerCase() === 'no') {
        textToEmbed = `${question} ${userInput}`;
        console.log('Processing yes/no response with context:', textToEmbed);
    }

    const output = await extractor(textToEmbed, { pooling: 'mean', normalize: true });
    return output.tolist()[0];
}

let artpediaData = {};
let artpediaEmbeddings = [];
let metData = {};
let metEmbeddings = [];

// Update the loading function for the new embeddings file
async function loadMuseumData() {
    try {
        // Load Artpedia dataset first (since we need its IDs)
        const artpediaResponse = await fetch('./data/artpedia.json');
        if (!artpediaResponse.ok) {
            throw new Error(`HTTP error loading Artpedia data, status: ${artpediaResponse.status}`);
        }
        artpediaData = await artpediaResponse.json();

        // Load Artpedia embeddings
        const embeddingsResponse = await fetch('./data/artpedia_embeddings.json');
        if (!embeddingsResponse.ok) {
            throw new Error(`HTTP error loading embeddings, status: ${embeddingsResponse.status}`);
        }
        const embeddingsData = await embeddingsResponse.json();

        // Process Artpedia embeddings
        artpediaEmbeddings = Object.keys(artpediaData).map((artpediaId, index) => {
            const embeddingItem = embeddingsData[index]; // Get embedding by index
            if (!embeddingItem || !Array.isArray(embeddingItem.embedding)) {
                console.warn(`Warning: No valid embedding found for artwork ID ${artpediaId}`);
                return null;
            }
            return {
                id: artpediaId, // Use the ID from artpedia.json
                embedding: embeddingItem.embedding,
                visualDescription: embeddingItem.visual_description || '',
                contextualDescription: embeddingItem.contextual_description || ''
            };
        }).filter(item => item !== null);

        // Load MET dataset
        const metResponse = await fetch('./data/met.json');
        if (!metResponse.ok) {
            throw new Error(`HTTP error loading MET data, status: ${metResponse.status}`);
        }
        metData = await metResponse.json();

        // Load MET embeddings
        const metEmbeddingsResponse = await fetch('./data/met_embeddings.json');
        if (!metEmbeddingsResponse.ok) {
            throw new Error(`HTTP error loading MET embeddings, status: ${metEmbeddingsResponse.status}`);
        }
        const metEmbeddingsData = await metEmbeddingsResponse.json();

        // Process MET embeddings - matching the actual MET data format
        metEmbeddings = metData.map((artwork, index) => {
            const embeddingItem = metEmbeddingsData[index];
            if (!embeddingItem || !Array.isArray(embeddingItem.embedding)) {
                console.warn(`Warning: No valid embedding found for MET artwork: ${artwork.title}`);
                return null;
            }
            return {
                id: index.toString(),
                embedding: embeddingItem.embedding,
                title: artwork.title,
                contextualDescription: artwork.contextual_sentences || '',
                imageUrl: artwork.img_url,
                year: artwork.year
            };
        }).filter(item => item !== null);
        console.log(`Museum data loaded successfully: ${Object.keys(artpediaData).length} Artpedia artworks and ${metData.length} MET fine arts artworks`);

    } catch (error) {
        console.error('Error loading museum data:', error);
        alert('Failed to load art data. Please check the console for more information.');
    }
}

// Caculate Cosine similarity
function cosineSimilarity(vecA, vecB) {
    if (!Array.isArray(vecA) || !Array.isArray(vecB) || vecA.length !== vecB.length) {
        throw new Error('Invalid vectors for similarity calculation');
    }
    const dotProduct = vecA.reduce((acc, val, i) => acc + val * vecB[i], 0);
    const normA = Math.sqrt(vecA.reduce((acc, val) => acc + val ** 2, 0));
    const normB = Math.sqrt(vecB.reduce((acc, val) => acc + val ** 2, 0));
    return normA === 0 || normB === 0 ? 0 : dotProduct / (normA * normB);
}

// Update the getRelevantKeywords function
async function getRelevantKeywords(userInput, question = '') {
    const userEmbedding = await getUserEmbedding(userInput, question);

    // Calculate similarities for Artpedia
    const artpediaSimilarities = artpediaEmbeddings
        .map((obj) => {
            const artworkData = artpediaData[obj.id];
            if (!artworkData) {
                console.log(`Warning: No artwork data found for ID ${obj.id}`);
                return null;
            }

            return {
                id: obj.id,
                title: artworkData.title || 'Untitled',
                year: artworkData.year || 'Unknown',
                imageUrl: artworkData.img_url || '',
                visualDescription: Array.isArray(artworkData.visual_sentences)
                    ? artworkData.visual_sentences.join(' ')
                    : '',
                contextualDescription: Array.isArray(artworkData.contextual_sentences)
                    ? artworkData.contextual_sentences.join(' ')
                    : '',
                similarity: cosineSimilarity(userEmbedding, obj.embedding),
                source: 'Artpedia'
            };
        })
        .filter(item => item !== null);

    // Calculate similarities for MET
    const metSimilarities = metEmbeddings
        .map((obj) => {
            const artworkData = metData[parseInt(obj.id)];
            if (!artworkData) {
                console.log(`Warning: No artwork data found for MET ID ${obj.id}`);
                return null;
            }

            return {
                id: obj.id,
                title: artworkData.title || 'Untitled',
                year: artworkData.year || 'Unknown',
                imageUrl: artworkData.img_url || '',
                visualDescription: '',  // MET data doesn't have visual descriptions
                contextualDescription: artworkData.contextual_sentences || '',
                similarity: cosineSimilarity(userEmbedding, obj.embedding),
                source: 'MET'
            };
        })
        .filter(item => item !== null);

    // Combine and sort all similarities
    const allSimilarities = [...artpediaSimilarities, ...metSimilarities];
    allSimilarities.sort((a, b) => b.similarity - a.similarity);

    // Get top 20 matches
    const top20 = allSimilarities.slice(0, 20);

    // Log the top 20 selections
    console.log('Top 20 Selected Artworks:');
    top20.forEach((artwork, index) => {
        console.log(`${index + 1}. ${artwork.title} (${artwork.source})
           Similarity: ${artwork.similarity.toFixed(4)}
           Year: ${artwork.year}`);
    });

    return top20;
}

// Get initial AI response and follow-up questions
async function getInitialAIResponse(userInput) {
    const response = await fetch(`${openai_api_proxy}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: 'gpt-3.5-turbo',
            messages: [
                {
                    role: 'system',
                    content: `You are Isaiah, an engaging AI art curator assistant who specializes in creating meaningful dialogues about art. 
                    Your responses should:
                    1. Acknowledge and interpret the user's theme or previous response
                    2. Share a brief insight about how this theme relates to art history or artistic expression
                    3. Ask 1 thoughtful follow-up question that help refine the exhibition's direction

                    Question Guidelines:
                    - DO NOT ask questions starting with "How"
                    - Focus on specific, direct questions starting with:
                        * "What specific..."
                        * "Which..."
                        * "Do you prefer..."
                        * "Are you interested in..."
                        * "Would you like..."
                    - Ask about concrete preferences rather than abstract concepts
                    
                    Format your response as a JSON object with these fields:
                    {
                        "interpretation": "your understanding of their input",
                        "insight": "your art-related observation",
                        "questions": ["1 follow-up question"]
                    }`
                },
                { role: 'user', content: `Based on the theme "${userInput}", start a meaningful dialogue to help curate an exhibition.` }
            ]
        }),
    });
    const data = await response.json();
    //console.log('Raw API response:', data);
    try {
        let content = data.choices[0].message.content;

        // Remove any markdown formatting
        content = content.replace(/```json\n?|\n?```/g, '').trim();
        //console.log('Cleaned content:', content);

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

// Follow-up questions
async function getFollowUpQuestion(userTheme, previousQuestions, previousAnswers) {
    // Max 4 questions
    if (previousQuestions.length >= 4) {
        return {
            interpretation: "I now have a good understanding of your preferences.",
            insight: "We've explored various aspects of your interests.",
            status: "COMPLETE",
            questions: []
        };
    }

    const response = await fetch(`${openai_api_proxy}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: 'gpt-3.5-turbo',
            messages: [
                {
                    role: 'system',
                    content: `You are Isaiah, an engaging AI art curator assistant. Review the conversation history and decide if you need more information to curate an exhibition.
                    Question Guidelines:
                    - DO NOT ask questions starting with "How"
                    - Focus on specific, direct questions starting with:
                        * "What specific..."
                        * "Which..."
                        * "Do you prefer..."
                        * "Are you interested in..."
                        * "Would you like..."
                    - Ask about concrete preferences rather than abstract concepts
                    - Keep questions concise and focused

                    If you need more information, provide a follow-up question.
                    Evaluate the user's input and previous responses to decide if you need more information using this scoring system:
                    1. Theme clarity (0-100):
                        - 0-30: Vague or unclear theme
                        - 31-70: Basic understanding of theme
                        - 71-100: Clear, well-defined theme

                    2. Context depth (0-100):
                        - 0-30: Minimal context about user's interests
                        - 31-70: Some understanding of preferences
                        - 71-100: Deep understanding of user's perspective

                    3. Artistic scope (0-100):
                        - 0-30: Limited ability to match with artworks
                        - 31-70: Sufficient for basic matching
                        - 71-100: Excellent basis for artwork selection

                    Respond with "COMPLETE" if:
                    - Average score across all categories is above 70, OR
                    - At least two categories score above 80, OR

                    Format your response as a JSON object:
                    {
                        "interpretation": "your understanding of their answer (use 'you' instead of 'the user')",
                        "insight": "a relevant art insight based on their answer",
                        "scores": {
                            "theme_clarity": number,
                            "context_depth": number,
                            "artistic_scope": number
                        },
                        "status": "CONTINUE or COMPLETE",
                        "questions": ["next follow-up question"] // empty array if status is COMPLETE
                    }

                    Important: Use "you" instead of "the user" in your responses.`
                },
                {
                    role: 'user',
                    content: `Theme: ${userTheme}
                    Previous questions: ${JSON.stringify(previousQuestions)}
                    User answers: ${JSON.stringify(previousAnswers)}
                    Number of questions asked: ${previousQuestions.length}
                    Please evaluate and decide if you need more information.`
                }
            ]
        })
    });

    const data = await response.json();
    let content = data.choices[0].message.content;
    content = content.replace(/```json\n?|\n?```/g, '').trim();
    //return JSON.parse(content);

    try {
        const parsed = JSON.parse(content);

        // Calculate average score
        const scores = parsed.scores || {};
        const avgScore = Object.values(scores).reduce((a, b) => a + b, 0) / 3;
        const highScores = Object.values(scores).filter(score => score > 80).length;

        // Force COMPLETE status if criteria met
        if (avgScore > 70 || highScores >= 2) {
            parsed.status = "COMPLETE";
            parsed.questions = [];
        }

        return parsed;
    } catch (error) {
        console.error('Error parsing AI response:', error);
        return {
            interpretation: "I understand your preferences.",
            insight: "Let's proceed with curating your exhibition.",
            status: "COMPLETE",
            questions: []
        };
    }
}

// Handle user preferences
function handleUserPreferences(preferences) {
    // Process user preferences and refine the search criteria
    return preferences.reduce((acc, pref) => {
        const [key, value] = pref.split(':').map(str => str.trim());

        // Handle yes/no/other responses
        if (value === 'positive preference') {
            acc[key] = 'yes';
        } else if (value === 'negative preference') {
            acc[key] = 'no';
        } else {
            acc[key] = value;
        }

        return acc;
    }, {});
}

// Initiate the conversation
async function initiateConversation(userInput) {
    const chatDiv = document.getElementById('chat-interface');
    chatDiv.innerHTML = '';

    appendMessage(chatDiv, `User: ${userInput}`, 'user');
    appendMessage(chatDiv, "I'm thinking about your theme...", 'ai');

    try {
        const aiResponse = await getInitialAIResponse(userInput);

        const preferences = await displayFollowUpQuestions(aiResponse);  // Pass aiResponse instead of followUpQuestions
        const refinedCriteria = handleUserPreferences(preferences);

        appendMessage(chatDiv, "I'll curate an exhibition based on your preferences and curation criteria such as Relevance, Narrative, Diversity, and Complementarity.", 'ai');
        await curateExhibition({ ...refinedCriteria, initialInput: userInput });
    } catch (error) {
        console.error('Error in conversation:', error);
        appendMessage(chatDiv, "I'm sorry, but I encountered an error while processing your request.", 'ai');
    }
}

// Helper function to wait
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Display follow-up questions and get user preferences
async function displayFollowUpQuestions(response) {
    const chatDiv = document.getElementById('chat-interface');
    const preferences = [];
    const previousQuestions = [];
    const previousAnswers = [];
    let questionCount = 0;

    // Clear previous conversation before showing new content
    //chatDiv.innerHTML = '';

    // Display initial interpretation and insight with delays
    if (response.interpretation) {
        appendMessage(chatDiv, response.interpretation, 'ai');
        await delay(1800);
    }
    if (response.insight) {
        appendMessage(chatDiv, response.insight, 'ai');
        await delay(1800);
    }

    // Handle initial follow-up question
    if (response.questions && Array.isArray(response.questions)) {
        for (const question of response.questions) {
            questionCount++;
            appendMessage(chatDiv, question, 'ai');
            const answer = await getUserInput(question);
            appendMessage(chatDiv, `User: ${answer}`, 'user');
            previousQuestions.push(question);
            previousAnswers.push(answer);

            // Modified handling of yes/no answers
            if (answer.toLowerCase() === 'yes') {
                preferences.push(`${question}: positive preference`);
            } else if (answer.toLowerCase() === 'no') {
                preferences.push(`${question}: negative preference`);
            } else {
                preferences.push(`${question}: ${answer}`);
            }
            // Clear conversation after answer
            //chatDiv.innerHTML = '';
        }
    }

    // Start iterative questioning
    while (questionCount < 4) {
        const followUpResponse = await getFollowUpQuestion(
            document.getElementById('theme-input').value,
            previousQuestions,
            previousAnswers
        );

        if (followUpResponse.interpretation) {
            appendMessage(chatDiv, followUpResponse.interpretation, 'ai');
            await delay(1800);
        }
        if (followUpResponse.insight) {
            appendMessage(chatDiv, followUpResponse.insight, 'ai');
            await delay(1800);
        }

        if (followUpResponse.status === 'COMPLETE' || questionCount >= 4) {
            appendMessage(chatDiv, "I think I have enough information to curate a meaningful exhibition for you.", 'ai');
            break;
        } else if (followUpResponse.questions && followUpResponse.questions.length > 0) {
            const question = followUpResponse.questions[0];
            questionCount++;
            appendMessage(chatDiv, question, 'ai');
            await delay(800);
            const answer = await getUserInput();
            appendMessage(chatDiv, `User: ${answer}`, 'user');
            previousQuestions.push(question);
            previousAnswers.push(answer);

            // Modified handling of yes/no answers
            if (answer.toLowerCase() === 'yes') {
                preferences.push(`${question}: positive preference`);
            } else if (answer.toLowerCase() === 'no') {
                preferences.push(`${question}: negative preference`);
            } else {
                preferences.push(`${question}: ${answer}`);
            }
        }
    }

    return preferences;
}

// Helper function to get user input
function getUserInput() {
    return new Promise((resolve) => {
        const chatDiv = document.getElementById('chat-interface');
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'user-input';
        const button = document.createElement('button');
        button.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M12 3L20 11L12 19M4 11H20"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              transform="rotate(-90 12 12)"
            />
          </svg>
        `;
        button.className = 'submit-button';

        const inputContainer = document.createElement('div');
        inputContainer.className = 'input-container';
        inputContainer.appendChild(input);
        inputContainer.appendChild(button);

        chatDiv.appendChild(inputContainer);

        // Scroll to the input field
        // chatDiv.scrollTop = chatDiv.scrollHeight;
        inputContainer.offsetHeight;
        inputContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
        input.focus();

        const handleSubmit = () => {
            const value = input.value;
            inputContainer.remove();
            resolve(value);
        };

        button.onclick = handleSubmit;
        input.onkeypress = (e) => {
            if (e.key === 'Enter') {
                handleSubmit();
            }
        };
    });
}

// Extract artist name from contextual sentences
async function extractArtistName(contextualSentences) {
    try {
        const sentences = Array.isArray(contextualSentences)
            ? contextualSentences
            : [contextualSentences].flat();

        const response = await fetch(`${openai_api_proxy}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'gpt-3.5-turbo',
                messages: [
                    {
                        role: 'system',
                        content: `Extract the artist's name from the given context. Return ONLY the artist's name.
                        If multiple artists are mentioned, return the primary artist.
                        If no artist is mentioned, return "Unknown Artist".
                        Do not include any additional text or explanation.`
                    },
                    {
                        role: 'user',
                        content: sentences.join(' ')
                    }
                ]
            })
        });

        const data = await response.json();
        return data.choices[0].message.content.trim() || 'Unknown Artist';
    } catch (error) {
        console.error('Error extracting artist name:', error);
        return 'Unknown Artist';
    }
}

async function curateExhibition(criteria) {
    // Combine all user inputs for better embedding results
    const userAnswers = Object.entries(criteria)
        .filter(([key, value]) => {
            if (key === 'initialInput') return false;
            // Only keep "yes" answers and non-yes/no responses
            return value === 'yes' || (value !== 'no' && value !== 'yes');
        })
        .map(([question, answer]) => {
            // For "yes" answers, include both question and answer
            if (answer === 'yes') {
                return `${question} ${answer}`;
            }
            // For other responses (excluding "no"), just include the answer
            return answer;
        })
        .join(' ');

    const combinedInput = `${criteria.initialInput} ${userAnswers}`;
    //console.log('Combined inputs:', combinedInput);

    // Get relevant artworks from both Artpedia and MET
    const relevantArtworks = await getRelevantKeywords(combinedInput);

    let finalArtworks = [];

    // Get Top 20 most relevant artworks based on cosine similarity
    if (relevantArtworks && relevantArtworks.length > 0) {
        // Prepare artwork data for GPT
        const artworksForCuration = relevantArtworks.slice(0, 20).map(artwork => ({
            title: artwork.title,
            year: artwork.year,
            visualDescription: artwork.visualDescription,
            contextualDescription: artwork.contextualDescription,
            similarity: artwork.similarity,
            source: artwork.source
        }));

        // Ask GPT to curate final selection
        const curatedSelection = await getCuratedSelection(artworksForCuration, combinedInput);

        // Map the selected artworks to include all necessary display information
        const selectedTitles = new Set();
        finalArtworks = await Promise.all(curatedSelection.selected_artworks
            .filter(selection => {
                const originalArtwork = relevantArtworks.find(a => a.title === selection.title);
                if (!originalArtwork || selectedTitles.has(originalArtwork.title)) {
                    return false;
                }
                selectedTitles.add(originalArtwork.title);
                return true;
            })
            .map(async selection => {
                const originalArtwork = relevantArtworks.find(a => a.title === selection.title);
                // Convert contextual_sentences to array if it's not already
                const contextualDesc = originalArtwork.contextualDescription || originalArtwork.contextual_sentences;
                let artistName = 'Unknown Artist';
                try {
                    artistName = await extractArtistName(contextualDesc);
                } catch (error) {
                    console.error('Error extracting artist name:', error);
                }
                return {
                    title: originalArtwork.title,
                    artist: artistName,
                    year: originalArtwork.year,
                    imageUrl: originalArtwork.imageUrl,
                    visualDescription: originalArtwork.visualDescription,
                    contextualDescription: contextualDesc,
                    source: originalArtwork.source,
                    curatorNotes: selection.explanation,
                    curatorial_notes: selection.curatorial_notes
                };
            }));

        // Display the results with curator's explanation
        displayArtworks(finalArtworks, curatedSelection.curation_explanation, curatedSelection.exhibition_title);
    }

    // Only use MET API if we have no results from built-in dataset
    if (finalArtworks.length === 0) {
        console.log('No Artpedia results found, falling back to MET API...');
        const remainingCount = 4;

        // Get search terms from OpenAI
        const curationResponse = await fetch(`${openai_api_proxy}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'gpt-3.5-turbo',
                messages: [
                    {
                        role: 'system',
                        content: `You are an art curator. Based on the user's theme and preferences, suggest exactly ${remainingCount} specific artwork descriptions to search for in the Metropolitan Museum of Art collection.
                        Format your response as a JSON array of search terms.`
                    },
                    {
                        role: 'user',
                        content: `Theme: ${combinedInput}`
                    }
                ]
            })
        });

        const data = await curationResponse.json();
        const searchTerms = JSON.parse(data.choices[0].message.content);
        console.log('MET API search terms:', searchTerms);

        // Search MET API for each term
        for (const searchTerm of searchTerms) {
            try {
                const searchUrl = `${museumAPIs['met']}/search?q=${encodeURIComponent(searchTerm)}&hasImages=true`;
                const searchResponse = await fetch(searchUrl);
                const searchData = await searchResponse.json();

                if (searchData.total > 0) {
                    const artwork = await fetchArtworks([searchData.objectIDs[0]]);
                    if (artwork.length > 0) {
                        artwork[0].source = 'MET';
                        finalArtworks.push(artwork[0]);
                    }
                }
            } catch (error) {
                console.error(`Error searching for term "${searchTerm}":`, error);
            }
        }
    }
}

// Make the AI to curate the final selection(4) out of 20, based on the curation criteria
async function getCuratedSelection(artworks, userTheme) {
    try {
        const response = await fetch(`${openai_api_proxy}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'gpt-3.5-turbo',
                messages: [
                    {
                        role: 'system',
                        content: `You are an art curator. Select exactly 4 artworks from the provided list that best create a cohesive exhibition based on these curation criteria:
                        - Relevance: Establish a clear, compelling theme that ties the works together. Ensure the theme resonates with contemporary audiences or offers fresh perspectives on known subjects.
                        - Contextualization: Provide historical, cultural, or biographical context where necessary to deepen understanding.
                        - Narrative Arc: Structure the exhibition to create a journey—building tension, climax, and resolution.
                        - Diversity and Representation: Include diverse voices, media, and perspectives to enrich the narrative.
                        - Complementarity: Ensure each work contributes uniquely to the overall theme without redundancy.


                        Return ONLY a JSON object with this EXACT structure, no additional text or formatting::
                        {
                            "exhibition_title": "A creative and engaging title for the exhibition",
                            "selected_artworks": [
                                {
                                    "title": "exact artwork title from the list",
                                    "explanation": "2-3 sentences explaining selection and role in exhibition",
                                    "curatorial_notes": "A paragraph explaining the selected artwork's relevance, context, role in narrative, diverse perspective, and unique contribution to the theme"
                                }
                            ],
                            "curation_explanation": "3-4 sentences explaining overall exhibition strategy and flow"
                        }`
                    },
                    {
                        role: 'user',
                        content: `Theme: ${userTheme}
                        Available artworks: ${JSON.stringify(artworks, null, 2)}`
                    }
                ],
                temperature: 0.5, // Add temperature to control randomness
                max_tokens: 1000 // Limit response length
            })
        });

        const data = await response.json();
        let content = data.choices[0].message.content;

        // Log the raw response for debugging
        console.log('Raw GPT response:', content);

        // Try multiple cleaning approaches
        let parsedResponse = null;
        const cleaningAttempts = [
            // Attempt 1: Basic markdown removal
            (str) => str.replace(/```json\n?|\n?```/g, '').trim(),
            // Attempt 2: More aggressive cleaning
            (str) => str.replace(/```[^`]*```/g, '').trim(),
            // Attempt 3: Extract JSON between curly braces
            (str) => {
                const match = str.match(/\{[\s\S]*\}/);
                return match ? match[0] : str;
            }
        ];

        for (const cleanFn of cleaningAttempts) {
            try {
                const cleaned = cleanFn(content);
                parsedResponse = JSON.parse(cleaned);
                if (parsedResponse && parsedResponse.selected_artworks) {
                    break;
                }
            } catch (e) {
                console.log('Cleaning attempt failed:', e.message);
                continue;
            }
        }

        if (!parsedResponse) {
            throw new Error('All parsing attempts failed');
        }

        // Normalize the response
        const normalizedResponse = {
            exhibition_title: parsedResponse.exhibition_title || `Exploring ${userTheme}`,
            selected_artworks: parsedResponse.selected_artworks
                .slice(0, 4)
                .map(artwork => ({
                    title: artwork.title,
                    explanation: artwork.explanation || "Selected for thematic relevance.",
                    curatorial_notes: artwork.curatorial_notes || `This artwork contributes to the exploration of ${userTheme}.`
                })),
            curation_explanation: parsedResponse.curation_explanation ||
                `A thoughtfully curated selection exploring ${userTheme}.`
        };

        // Fill missing artworks if needed
        while (normalizedResponse.selected_artworks.length < 4 && artworks.length > 0) {
            const nextArtwork = artworks[normalizedResponse.selected_artworks.length];
            normalizedResponse.selected_artworks.push({
                title: nextArtwork.title,
                explanation: "Selected to complement the exhibition theme.",
                curatorial_notes: `This artwork contributes to the exploration of ${userTheme}.`
            });
        }

        return normalizedResponse;

    } catch (error) {
        console.error('Curation Error Details:', {
            error: error.message,
            stack: error.stack
        });

        // Return fallback response
        return {
            exhibition_title: `Exploring ${userTheme}`,
            selected_artworks: artworks.slice(0, 4).map(artwork => ({
                title: artwork.title,
                explanation: "Selected for thematic relevance.",
                curatorial_notes: `This artwork contributes to the exploration of ${userTheme}.`
            })),
            curation_explanation: `A thoughtfully curated selection exploring ${userTheme} through diverse artistic perspectives.`
        };
    }

    //     // FROM HERE ORIGINAL JSON PARSING VERSION THAT KEEP RETURNS AN ERROR
    //     // Simple cleaning: only remove markdown formatting and trim
    //     let content = data.choices[0].message.content
    //         .replace(/```json\n?|\n?```/g, '')
    //         .trim();

    //     // Parse and validate response
    //     try {
    //         const parsed = JSON.parse(content);

    //         // Ensure response has required structure
    //         if (!parsed.selected_artworks || !Array.isArray(parsed.selected_artworks)) {
    //             throw new Error('Invalid response structure');
    //         }

    //         // Create normalized response with exactly 4 artworks
    //         const normalizedResponse = {
    //             selected_artworks: parsed.selected_artworks.slice(0, 4),
    //             curation_explanation: parsed.curation_explanation ||
    //                 `A curated selection exploring ${userTheme} through artistic expression.`
    //         };

    //         // Fill any missing slots with default entries
    //         while (normalizedResponse.selected_artworks.length < 4 && artworks.length > 0) {
    //             const nextArtwork = artworks[normalizedResponse.selected_artworks.length];
    //             normalizedResponse.selected_artworks.push({
    //                 title: nextArtwork.title,
    //                 explanation: "Selected to complement the exhibition theme.",
    //                 curatorial_notes: `This artwork contributes to the exploration of ${userTheme}.`
    //             });
    //         }

    //         return normalizedResponse;

    //     } catch (parseError) {
    //         console.error('JSON Parse Error:', parseError);
    //         throw new Error('Failed to parse curator response');
    //     }

    // } catch (error) {
    //     console.error('Curation Error:', error);

    //     // Fallback response using available artworks
    //     return {
    //         selected_artworks: artworks.slice(0, 4).map(artwork => ({
    //             title: artwork.title,
    //             explanation: "Selected for thematic relevance.",
    //             curatorial_notes: `This artwork contributes to the exploration of ${userTheme}.`
    //         })),
    //         curation_explanation: `A thoughtfully curated selection exploring ${userTheme} through diverse artistic perspectives.`
    //     };
    // }
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

// Summarize the visual and contextual descriptions into a single paragraph of 2-3 sentences
async function generateWallText(visualDesc, contextualDesc, title) {
    try {
        const response = await fetch(`${openai_api_proxy}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'gpt-3.5-turbo',
                messages: [
                    {
                        role: 'system',
                        content: `You are an art curator writing concise and engaging wall text for museum displays. 
                        Create a single, cohesive paragraph of 2-3 sentences that combines the visual description and historical context.
                        
                        Important guidelines:
                        - Do NOT start with phrases like "Step into", "Experience", "Discover", or any similar introductory phrases
                        - Do NOT mention the title of the artwork or that it's a painting/artwork
                        - Do NOT mention where the artwork is currently located
                        - Focus on describing the scene, its significance, and historical context
                        - Keep the text accessible to general audiences while maintaining scholarly integrity
                        - Aim for a natural, engaging flow that directly discusses the content and context`
                    },
                    {
                        role: 'user',
                        content: `Create wall text for "${title}" based on these descriptions:
                        Visual description: ${visualDesc}
                        Historical context: ${contextualDesc}`
                    }
                ]
            })
        });

        const data = await response.json();
        return data.choices[0].message.content.trim();
    } catch (error) {
        console.error('Error generating wall text:', error);
        return `${visualDesc} ${contextualDesc}`; // Fallback to original descriptions if API fails
    }
}

// Display artworks
function displayArtworks(artworks, curatorExplanation, exhibitionTitle) {
    const exhibitionSection = document.getElementById('exhibition-section');
    exhibitionSection.style.display = 'block';

    // Update the h1 title with the GPT-generated title
    const exhibitionTitleElement = document.getElementById('exhibition-title');
    exhibitionTitleElement.textContent = exhibitionTitle;

    // Clear and update curator's explanation
    const curatorDiv = document.getElementById('curator-explanation');
    curatorDiv.innerHTML = `
        <h2>Curator's Note</h2>
        <p>${curatorExplanation}</p>
    `;

    // Clear and update artworks display
    const artworksDisplay = document.getElementById('artworks-display');
    artworksDisplay.innerHTML = '';

    // Add navigation buttons
    artworksDisplay.innerHTML = `
        <button class="gallery-nav prev">
            <svg viewBox="0 0 24 24">
                <path d="M15 18l-6-6 6-6" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
        </button>
        <button class="gallery-nav next">
            <svg viewBox="0 0 24 24">
                <path d="M9 18l6-6-6-6" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
        </button>
        <div class="gallery-indicators"></div>
    `;

    let currentIndex = 0;

    // Use Promise.all to handle all wall text generations concurrently
    // Display artworks with detailed information
    Promise.all(artworks.map(async (artwork) => {
        const wallText = await generateWallText(
            artwork.visualDescription,
            artwork.contextualDescription,
            artwork.title
        );

        const artElement = document.createElement('div');
        artElement.className = 'artwork';

        // Combine curator notes into a single paragraph
        artElement.innerHTML = `
            <h3>${artwork.title}</h3>
            ${artwork.artist ? `<p>${artwork.artist}</p>` : ''}
            ${artwork.year ? `<p>${artwork.year}</p>` : ''}
            <img src="${artwork.imageUrl}" alt="${artwork.title}" width="200">
            <p class="wall-text">${wallText}</p>
            <div class="curator-notes">
                <h4>Curatorial Details</h4>
                <p>${artwork.curatorial_notes}</p>
            </div>
        `;
        //<p class="source">Source: ${artwork.source}</p>
        return artElement;
    })).then(artElements => {
        // Add all artworks to display
        artElements.forEach((element, index) => {
            if (index === 0) element.classList.add('active');
            artworksDisplay.appendChild(element);
        });

        // Add indicators
        const indicatorsDiv = artworksDisplay.querySelector('.gallery-indicators');
        artElements.forEach((_, index) => {
            const indicator = document.createElement('div');
            indicator.className = `indicator ${index === 0 ? 'active' : ''}`;
            indicator.addEventListener('click', () => showArtwork(index));
            indicatorsDiv.appendChild(indicator);
        });

        // Navigation functionality
        const prevBtn = artworksDisplay.querySelector('.gallery-nav.prev');
        const nextBtn = artworksDisplay.querySelector('.gallery-nav.next');

        function showArtwork(index) {
            const artworks = artworksDisplay.querySelectorAll('.artwork');
            const indicators = artworksDisplay.querySelectorAll('.indicator');

            artworks.forEach(artwork => artwork.classList.remove('active'));
            indicators.forEach(indicator => indicator.classList.remove('active'));

            currentIndex = index;
            artworks[currentIndex].classList.add('active');
            indicators[currentIndex].classList.add('active');
        }

        prevBtn.addEventListener('click', () => {
            const newIndex = (currentIndex - 1 + artElements.length) % artElements.length;
            showArtwork(newIndex);
        });

        nextBtn.addEventListener('click', () => {
            const newIndex = (currentIndex + 1) % artElements.length;
            showArtwork(newIndex);
        });

        // Add keyboard navigation
        document.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowLeft') prevBtn.click();
            if (e.key === 'ArrowRight') nextBtn.click();
        });

        // Scroll to exhibition section
        setTimeout(() => {
            exhibitionSection.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });
        }, 10);
    });
}

// Helper function to append messages to the chat interface
function appendMessage(chatDiv, message, sender) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${sender}`;

    // Create avatar
    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    // avatar.textContent = sender === 'ai' ? 'I' : 'U';
    avatar.innerHTML = `
        <svg width="24px" stroke-width="1.5" height="24px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" color="#ffffff">
            <path d="M4 19V5C4 3.89543 4.89543 3 6 3H19.4C19.7314 3 20 3.26863 20 3.6V16.7143" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round"></path>
            <path d="M6 17L20 17" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round"></path>
            <path d="M6 21L20 21" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round"></path>
            <path d="M6 21C4.89543 21 4 20.1046 4 19C4 17.8954 4.89543 17 6 17" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path>
            <path d="M9 7L15 7" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round"></path>
        </svg>
    `;

    // Create message content
    const messageContent = document.createElement('div');
    messageContent.className = 'message-content';

    // Handle message content
    if (sender === 'user') {
        messageContent.textContent = message.replace(/^User: /, '');
    } else if (sender === 'ai') {
        messageContent.textContent = message;
    }

    // Assemble message
    messageDiv.appendChild(avatar);
    messageDiv.appendChild(messageContent);
    chatDiv.appendChild(messageDiv);
    //chatDiv.scrollTop = chatDiv.scrollHeight;
    messageDiv.offsetHeight;

    // Smooth scroll to the new message
    messageDiv.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// Event listener for the submit button
document.querySelector('.submit-button').addEventListener('click', handleSubmit);
document.getElementById('theme-input').addEventListener('keypress', (event) => {
    if (event.key === 'Enter') {
        handleSubmit();
    }
});

async function handleSubmit() {
    const themeInput = document.getElementById('theme-input');  // Get the element
    const theme = themeInput.value;  // Get its value

    if (!artpediaData || Object.keys(artpediaData).length === 0) {
        console.error('Art data not loaded yet');
        alert('Please wait for the art data to finish loading.');
        return;
    }

    if (theme) {
        themeInput.value = '';  // Now this works because themeInput is the element
        document.getElementById('chat-interface').style.display = 'block';
        document.querySelector('.input-section').classList.add('chat-started');
        console.log('Starting conversation with theme:', theme);
        await initiateConversation(theme);
    } else {
        alert('Please enter a theme for the exhibition.');
    }
}

window.addEventListener('DOMContentLoaded', async () => {
    await loadMuseumData();
    //console.log('Initial data loading complete');
});

document.addEventListener('DOMContentLoaded', () => {
    const helpButton = document.querySelector('.help-button');
    const helpPopup = document.querySelector('.help-popup');
    const questionIcon = helpButton.querySelector('svg:first-child');
    const xIcon = helpButton.querySelector('svg:last-child');

    helpButton.addEventListener('click', () => {
        helpPopup.classList.toggle('show');
        questionIcon.style.display = questionIcon.style.display === 'none' ? 'block' : 'none';
        xIcon.style.display = xIcon.style.display === 'none' ? 'block' : 'none';
    });

    // Close popup when clicking outside
    document.addEventListener('click', (e) => {
        if (!helpPopup.contains(e.target) && !helpButton.contains(e.target)) {
            helpPopup.classList.remove('show');
            questionIcon.style.display = 'block';
            xIcon.style.display = 'none';
        }
    });
});