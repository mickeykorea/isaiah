// Isaiah — AI art curation. Runs entirely in the browser:
//   1. embed the user's theme + interview answers with Transformers.js (bge-small-en-v1.5)
//   2. dot-product against precomputed artwork embeddings (Artpedia + MET), keep the top 20
//   3. one chat-completion call picks 4 works and writes title, curator's note, wall text, artist
// All OpenAI calls go through the Cloudflare Worker in ./worker (it pins the model and holds the key).

import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/transformers.min.js';

env.allowLocalModels = false; // skip the 404 probes for ./models/*, go straight to the Hugging Face hub

const OPENAI_PROXY = 'https://isaiah-openai-proxy.iamyegyun.workers.dev';
const DIM = 384;          // bge-small-en-v1.5 output size; must match data/convert/pack-embeddings.js
const TOP_K = 20;         // candidates handed to the curator
const MAX_QUESTIONS = 4;  // interview length cap
const PICKS = 4;          // artworks per exhibition

// ---------------------------------------------------------------------------
// Data + embeddings
// ---------------------------------------------------------------------------

const extractorPromise = pipeline('feature-extraction', 'Xenova/bge-small-en-v1.5');

let artworks = [];   // [{ title, year, imageUrl, visual, context, source }]
let vectors = null;  // Float32Array, artworks.length * DIM, unit-length rows

async function fetchOk(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return res;
}

async function loadMuseumData() {
    try {
        const [artpedia, met, aBuf, mBuf] = await Promise.all([
            fetchOk('./data/artpedia.json').then(r => r.json()),
            fetchOk('./data/met.json').then(r => r.json()),
            fetchOk('./data/artpedia_embeddings.bin').then(r => r.arrayBuffer()),
            fetchOk('./data/met_embeddings.bin').then(r => r.arrayBuffer()),
        ]);

        // Order must match the packing order (Object.values of artpedia, then met array).
        artworks = [
            ...Object.values(artpedia).map(a => ({
                title: a.title || 'Untitled',
                year: a.year || 'Unknown',
                imageUrl: a.img_url || '',
                visual: (a.visual_sentences || []).join(' '),
                context: (a.contextual_sentences || []).join(' '),
                source: 'Artpedia',
            })),
            ...met.map(a => ({
                title: a.title || 'Untitled',
                year: a.year || 'Unknown',
                imageUrl: a.img_url || '',
                visual: '',
                context: a.contextual_sentences || '',
                source: 'MET',
            })),
        ];

        const a = new Float32Array(aBuf);
        const m = new Float32Array(mBuf);
        vectors = new Float32Array(a.length + m.length);
        vectors.set(a);
        vectors.set(m, a.length);
        if (vectors.length !== artworks.length * DIM) {
            throw new Error(`embedding count ${vectors.length / DIM} != artwork count ${artworks.length}`);
        }
        console.log(`Museum data loaded: ${Object.keys(artpedia).length} Artpedia + ${met.length} MET artworks`);
    } catch (error) {
        console.error('Error loading museum data:', error);
        showAlert('Failed to load the art data. Please refresh the page.');
    }
}

async function embed(text) {
    const extractor = await extractorPromise;
    const out = await extractor(text, { pooling: 'mean', normalize: true });
    return out.data; // Float32Array(DIM)
}

// Both sides are unit vectors, so the dot product is the cosine similarity.
async function findRelevant(text) {
    const q = await embed(text);
    const scored = artworks.map((_, i) => {
        let s = 0;
        const o = i * DIM;
        for (let d = 0; d < DIM; d++) s += q[d] * vectors[o + d];
        return { i, s };
    });
    scored.sort((x, y) => y.s - x.s);
    const top = scored.slice(0, TOP_K).map(({ i, s }) => ({ ...artworks[i], similarity: s }));
    console.log('Top candidates:', top.map(t => `${t.title} (${t.source}, ${t.similarity.toFixed(3)})`));
    return top;
}

// ---------------------------------------------------------------------------
// OpenAI (via proxy)
// ---------------------------------------------------------------------------

// The worker sets the model; we only send messages. reasoning_effort 'none' keeps latency low.
async function chat(system, user) {
    const res = await fetch(`${OPENAI_PROXY}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            reasoning_effort: 'none',
            response_format: { type: 'json_object' },
            messages: [
                { role: 'system', content: system },
                { role: 'user', content: user },
            ],
        }),
    });
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const err = new Error(`API request failed with status ${res.status}: ${body.error?.message || ''}`);
        err.status = res.status;
        err.code = body.error?.code || body.error?.type || '';
        throw err;
    }
    const data = await res.json();
    return JSON.parse(data.choices[0].message.content);
}

const PERSONA = `You are Isaiah, an AI art curator. You help a visitor shape a personal exhibition through a short, natural conversation, then curate it from a collection of paintings and objects (Artpedia and the Metropolitan Museum of Art, mostly European and American, medieval to early 20th century).`;

const INTERVIEW_RULES = `Interview rules:
- Ask exactly ONE question per turn. Never ask a question that has already been asked, even rephrased. If an earlier answer was vague, "yes", or "no", treat that aspect as settled (no strong preference) and move to a different aspect.
- Each question should open a NEW aspect, chosen from: subject matter, mood or tone, period or region, medium or style, and the journey the visitor should experience. Skip aspects the theme already makes clear.
- Keep questions concrete and answerable in a few words. Offering two or three example options is good; yes/no questions are not.
- Speak directly to the visitor as "you". Never comment on the quality or clarity of their answers, and never mention scores or the interview process itself.
- "interpretation": one sentence restating what you now understand about the exhibition they want.
- "insight": one or two sentences connecting their answer to art history or artistic practice. Be specific (name movements, artists, or techniques) rather than generic.`;

// First turn: interpret the theme and ask one question.
function getInitialResponse(theme) {
    return chat(
        `${PERSONA}
Interpret the visitor's theme, share one insight about how it relates to art history, and ask ONE question that helps refine the exhibition.
${INTERVIEW_RULES}

Respond with a JSON object: {"interpretation": string, "insight": string, "question": string}`,
        `The visitor's theme: "${theme}"`
    );
}

// Later turns: decide whether we know enough, otherwise ask one more question.
async function getFollowUp(theme, qa) {
    if (qa.length >= MAX_QUESTIONS) return { status: 'COMPLETE', question: null };

    const parsed = await chat(
        `${PERSONA}
Review the conversation so far, respond to the visitor's latest answer, and decide whether you know enough to curate.
${INTERVIEW_RULES}

Rate the conversation 0-100 on:
- theme_clarity: how well-defined the exhibition's theme is
- context_depth: how well you understand what the visitor wants to feel or explore
- artistic_scope: how confidently you could choose artworks now
Set "status" to "COMPLETE" when the average is above 70, when two scores exceed 80, or when another question would not change your selection. Otherwise set "CONTINUE" and ask one new question.

Respond with a JSON object: {"interpretation": string, "insight": string, "scores": {"theme_clarity": n, "context_depth": n, "artistic_scope": n}, "status": "CONTINUE" | "COMPLETE", "question": string | null}`,
        `Theme: ${theme}
Questions already asked and the visitor's answers (do not repeat any of these): ${JSON.stringify(qa)}
Questions asked so far: ${qa.length} of ${MAX_QUESTIONS}`
    );

    // Enforce the stopping rule client-side rather than trusting the model's status.
    const scores = Object.values(parsed.scores || {});
    const avg = scores.reduce((a, b) => a + b, 0) / (scores.length || 1);
    const high = scores.filter(s => s > 80).length;
    const asked = new Set(qa.map(x => x.question.trim().toLowerCase()));
    if (avg > 70 || high >= 2 || !parsed.question || asked.has(parsed.question.trim().toLowerCase())) {
        parsed.status = 'COMPLETE';
        parsed.question = null;
    }
    return parsed;
}

// One call picks the exhibition and writes all the copy (title, note, per-work artist + wall text).
async function getCuratedSelection(candidates, theme, brief) {
    const list = candidates.map(c => ({
        title: c.title, year: c.year, source: c.source,
        visualDescription: c.visual, contextualDescription: c.context,
    }));
    try {
        const parsed = await chat(
            `${PERSONA}
Select exactly ${PICKS} artworks from the provided list that together form a cohesive exhibition for this visitor, judged on:
- Relevance: a clear, compelling theme that ties the works together and honours the visitor's stated preferences (treat "no" answers as exclusions)
- Contextualization: historical, cultural, or biographical context that deepens understanding
- Narrative arc: order the works as a journey with a beginning, a turning point, and a resolution
- Diversity and representation: varied voices, periods, media, and perspectives where the list allows
- Complementarity: each work contributes something the others do not

For each selected work write:
- "artist": the artist's name as given in the contextual description, or "Unknown Artist" if none is named. Never guess.
- "wall_text": 2-3 sentences of museum wall text for a general audience, scholarly in substance. The title, artist and year are printed above it, so do not restate them: begin directly with what is happening in the scene, then its significance and context. Build on the provided descriptions; you may add widely known context about the artist or period, but do not invent details about what the image shows. Do not open with hooks like "Step into", "Experience", or "Discover"; do not call it a painting or artwork; do not say where it is currently held.
- "curatorial_notes": one paragraph on why this work belongs: its relevance to the theme, its context, its place in the narrative, and what it uniquely adds.

Respond with a JSON object with EXACTLY this structure:
{"exhibition_title": "a creative, engaging title", "selected_artworks": [{"title": "copied exactly from the list", "artist": "...", "wall_text": "...", "curatorial_notes": "..."}], "curation_explanation": "3-4 sentences, addressed to the visitor, on the exhibition's idea and how it unfolds"}`,
            `${brief}\n\nAvailable artworks: ${JSON.stringify(list)}`
        );

        // Resolve titles back to candidates, drop unknowns/duplicates, top up from the ranked list.
        const byTitle = new Map(candidates.map(c => [c.title, c]));
        const seen = new Set();
        const picks = [];
        for (const sel of parsed.selected_artworks || []) {
            const c = byTitle.get(sel.title);
            if (!c || seen.has(c.title)) continue;
            seen.add(c.title);
            picks.push({ ...c, artist: sel.artist, wallText: sel.wall_text, curatorialNotes: sel.curatorial_notes });
        }
        for (const c of candidates) {
            if (picks.length >= PICKS) break;
            if (!seen.has(c.title)) { seen.add(c.title); picks.push(fallbackPick(c, theme)); }
        }
        return {
            title: parsed.exhibition_title || `Exploring ${theme}`,
            explanation: parsed.curation_explanation || `A curated selection exploring ${theme}.`,
            picks: picks.slice(0, PICKS),
        };
    } catch (error) {
        // Quota/network errors must surface; only degrade on malformed model output.
        if (error.status) throw error;
        console.error('Curation parse error, falling back to top matches:', error);
        return {
            title: `Exploring ${theme}`,
            explanation: `A thoughtfully curated selection exploring ${theme} through diverse artistic perspectives.`,
            picks: candidates.slice(0, PICKS).map(c => fallbackPick(c, theme)),
        };
    }
}

function fallbackPick(c, theme) {
    return {
        ...c,
        artist: '',
        wallText: `${c.visual} ${c.context}`.trim(),
        curatorialNotes: `This artwork contributes to the exploration of ${theme}.`,
    };
}

// ---------------------------------------------------------------------------
// Conversation flow
// ---------------------------------------------------------------------------

const delay = ms => new Promise(r => setTimeout(r, ms));

async function initiateConversation(theme) {
    const chatDiv = document.getElementById('chat-interface');
    chatDiv.innerHTML = '';
    appendMessage(chatDiv, theme, 'user');
    appendMessage(chatDiv, "I'm thinking about your theme...", 'ai');

    try {
        const qa = await runInterview(theme);
        appendMessage(chatDiv, "I'll curate an exhibition based on your preferences and curation criteria such as Relevance, Narrative, Diversity, and Complementarity.", 'ai');
        await curateExhibition(theme, qa);
    } catch (error) {
        console.error('Error in conversation:', error);
        handleAPIError(error);
        appendMessage(chatDiv, "I'm sorry, but I encountered an error while processing your request.", 'ai');
    }
}

// Ask up to MAX_QUESTIONS questions; returns [{ question, answer }].
async function runInterview(theme) {
    const chatDiv = document.getElementById('chat-interface');
    const qa = [];

    const say = async (r) => {
        if (r.interpretation) { appendMessage(chatDiv, r.interpretation, 'ai'); await delay(1800); }
        if (r.insight) { appendMessage(chatDiv, r.insight, 'ai'); await delay(1800); }
    };
    const ask = async (question) => {
        appendMessage(chatDiv, question, 'ai');
        await delay(800);
        const answer = await getUserInput();
        appendMessage(chatDiv, answer, 'user');
        qa.push({ question, answer });
    };

    const first = await getInitialResponse(theme);
    await say(first);
    if (first.question) await ask(first.question);

    while (qa.length < MAX_QUESTIONS) {
        const next = await getFollowUp(theme, qa);
        await say(next);
        if (next.status === 'COMPLETE') break;
        await ask(next.question);
    }
    appendMessage(chatDiv, 'I think I have enough information to curate a meaningful exhibition for you.', 'ai');
    return qa;
}

function getUserInput() {
    return new Promise((resolve) => {
        const chatDiv = document.getElementById('chat-interface');
        const container = document.createElement('div');
        container.className = 'input-container';
        container.innerHTML = `
            <input type="text" class="user-input">
            <button class="submit-button">${ARROW_SVG}</button>`;
        chatDiv.appendChild(container);
        container.scrollIntoView({ behavior: 'smooth', block: 'center' });

        const input = container.querySelector('input');
        input.focus();
        const submit = () => {
            if (!input.value.trim()) return;
            const value = input.value;
            container.remove();
            resolve(value);
        };
        container.querySelector('button').onclick = submit;
        input.onkeydown = (e) => { if (e.key === 'Enter') submit(); };
    });
}

// Retrieval query: "no" answers are dropped, "yes" answers keep the question, anything else keeps the answer.
// The curator gets the full transcript so it can honour exclusions.
async function curateExhibition(theme, qa) {
    const parts = qa
        .filter(({ answer }) => answer.trim().toLowerCase() !== 'no')
        .map(({ question, answer }) => (answer.trim().toLowerCase() === 'yes' ? question : answer));
    const query = [theme, ...parts].join(' ');
    const brief = [`Theme: ${theme}`, ...qa.map(({ question, answer }) => `Q: ${question}\nA: ${answer}`)].join('\n');

    const candidates = await findRelevant(query);
    const exhibition = await getCuratedSelection(candidates, theme, brief);
    displayExhibition(exhibition);

    // Anonymous usage log; never blocks or surfaces errors.
    fetch(`${OPENAI_PROXY}/log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
        body: JSON.stringify({ theme, qa, title: exhibition.title, picks: exhibition.picks.map(p => p.title) }),
    }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const ARROW_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 3L20 11L12 19M4 11H20" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" transform="rotate(-90 12 12)"/>
</svg>`;

function displayExhibition({ title, explanation, picks }) {
    const section = document.getElementById('exhibition-section');
    section.style.display = 'block';
    document.getElementById('exhibition-title').textContent = title;
    document.getElementById('curator-explanation').innerHTML = `<h2>Curator's Note</h2><p>${esc(explanation)}</p>`;

    const display = document.getElementById('artworks-display');
    display.innerHTML = `
        <button class="gallery-nav prev" aria-label="Previous artwork"><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        <button class="gallery-nav next" aria-label="Next artwork"><svg viewBox="0 0 24 24"><path d="M9 18l6-6-6-6" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        <div class="gallery-indicators"></div>`;
    const indicators = display.querySelector('.gallery-indicators');

    picks.forEach((a, i) => {
        const el = document.createElement('div');
        el.className = 'artwork' + (i === 0 ? ' active' : '');
        el.innerHTML = `
            <h3>${esc(a.title)}</h3>
            ${a.artist ? `<p>${esc(a.artist)}</p>` : ''}
            ${a.year ? `<p>${esc(a.year)}</p>` : ''}
            <img src="${esc(a.imageUrl)}" alt="${esc(a.title)}" width="200">
            <p class="wall-text">${esc(a.wallText)}</p>
            <div class="curator-notes"><h4>Curatorial Details</h4><p>${esc(a.curatorialNotes)}</p></div>`;
        display.appendChild(el);

        const dot = document.createElement('button');
        dot.className = 'indicator' + (i === 0 ? ' active' : '');
        dot.setAttribute('aria-label', `Artwork ${i + 1} of ${picks.length}`);
        dot.onclick = () => showArtwork(i);
        indicators.appendChild(dot);
    });

    let current = 0;
    const showArtwork = (i) => {
        current = (i + picks.length) % picks.length;
        display.querySelectorAll('.artwork').forEach((el, j) => el.classList.toggle('active', j === current));
        display.querySelectorAll('.indicator').forEach((el, j) => el.classList.toggle('active', j === current));
    };
    display.querySelector('.gallery-nav.prev').onclick = () => showArtwork(current - 1);
    display.querySelector('.gallery-nav.next').onclick = () => showArtwork(current + 1);

    setTimeout(() => section.scrollIntoView({ behavior: 'smooth', block: 'start' }), 10);
}

// Registered once; drives whichever gallery is currently rendered.
document.addEventListener('keydown', (e) => {
    const sel = e.key === 'ArrowLeft' ? '.gallery-nav.prev' : e.key === 'ArrowRight' ? '.gallery-nav.next' : null;
    if (sel) document.querySelector(sel)?.click();
});

const AVATAR_SVG = `
    <svg width="30px" height="42px" viewBox="0 0 31.31 44.66" xmlns="http://www.w3.org/2000/svg" style="transform: translateY(7px)">
        <defs>
            <style>
                .cls-1 {
                    fill: #fff;
                }
                .cls-1, .cls-2 {
                    stroke: #fff;
                    stroke-miterlimit: 10;
                    stroke-width: .5px;
                }
                .cls-2 {
                    fill: none;
                }
            </style>
        </defs>
        <path class="cls-2" d="M3.57,10.48c-.36,1.98-.24,4.36,0,5.83s1.27,3.33,1.27,3.33l.83.21s.52.5.73.93c.22.42.7,1.12,1.04,1.82.33.7.94,1.58,1.36,2.18.43.61,1.61,1.73,2.91,2.71,1.31.97,1.83.48,2.46.42.64-.06.76-.27,1.29-.52.52-.24,1.41-.97,1.72-1.15.3-.18,1.33-.7,1.79-.94.45-.24,1.24-.67,2-1.27.76-.61,1.55-1.95,1.55-1.95l.45-.63.52-.64s.85-1.34,1-1.58.49-.15.88-.03.73-.12.88-.49c.15-.36.33-.3.67-.63.33-.34.21-.79.24-1.22.03-.42.18-.75.18-1.24v-1.52c0-.36-.24-1.55-.36-2.18-.12-.64-.73-2.73-1-3.61-.28-.88-1.34-2.86-1.7-3.31-.37-.46-2.37-2.19-2.79-2.58-.43-.4-2.19-1.03-2.92-1.31-.73-.27-1.73-.57-1.73-.57,0,0-1.36-.03-1.7-.03s-.3-.22-.88-.18c-.57.03-2.3.39-3.03.57s-2.73,1.49-3.19,1.85c-.45.37-2.37,2.49-2.37,2.49-1.11,1.27-1.74,3.26-2.1,5.24Z"/>
        <path class="cls-1" d="M20.45,10.98c-.11-.4-.23-.41-.39-.41-.15,0-.98-.17-1.21-.27-.23-.1-.2-.16-.54-.16s-.59.12-.59.12c0,0-.23-.04-1-.1-.77-.06-1.32.06-1.88.18-.56.13-1.2.37-1.54.47-.34.1-.67.35-1.06.65-.38.3-.65.8-.65.8,0,0-.33-.02-.52-.02-.18,0-.65.06-.94.12-.28.05-.58.35-.6.24-.01-.12-.58-.37-1.14-.53-.55-.16-1.54.06-2.51.24-.97.19-1.25.46-1.42.53-.18.07-.86.81-.86.81,0,0-.06,1.11.05,1.12.1.01.32.11.44.25.12.14.33.61.46.96s.2.25.77.83c.57.58.4.26,1.17.39.77.14,1.49-.32,2.1-.64.6-.31.73-.82.91-1.11.17-.28.27-.83.38-1.25.1-.41.34-.66.55-.78.22-.13.7-.05.96.02.27.08.19.08.42.33.22.25.24.41.59.89.35.47.57.44,1.09.66.51.23.58.09,1.21.09s1.22-.21,1.95-.43c.74-.21,1.01-.67,1.29-1.01.28-.34.47-.58.64-1.36.18-.78.1-.97.1-.97,0,0,.19.06.66.12.47.07,1.2.08,1.2.08,0,0,.03-.45-.09-.86ZM9.35,14.76c-.18.31-.19.37-.6.73-.41.37-.5.42-1.04.6-.55.18-.53.25-1.19.25s-.39.16-.72,0c-.34-.15-.36-.12-.62-.43-.27-.3-.46-.84-.55-1.02-.09-.17-.49-.8-.49-.8,0,0,.14-.52.48-.68.34-.15.56-.31.93-.36.38-.06.8-.16,1.09-.13.28.03.64-.23,1.07-.23s.75-.09,1.05,0c.29.08.47.03.64.49.17.46.17.52.17.81s-.05.45-.22.77ZM18.09,12.47c-.04.18-.18.55-.35.76-.18.22-.66.71-.89.81-.23.09-1.23.41-1.51.49-.27.08-.46.08-1,.08s-.66.21-1.06,0c-.39-.2-.34-.16-.6-.54-.26-.39-.54-.85-.54-.85,0,0-.15-.17-.08-.39.08-.22.24-.29.24-.29,0,0,.31-.44.84-.67.54-.23.74-.43,1.19-.53.45-.1.51-.12,1.01-.23s.88-.14,1.28-.12c.39.01.89-.11,1.12.06.23.18.47.26.47.59s-.08.65-.12.83Z"/>
        <path class="cls-2" d="M4.84,19.64s.53-.05.69-.94.16-1.47.16-1.47c0,0,.49-1.9.36-2.52s-.23-1.51-.23-1.51c0,0-.13-1.21-.13-1.7s-.12-1.04.38-1.35.57-1.07,1.29-.94,1.18.62,2.42.52,1.77-.23,2.88-.33,2.69-.56,3.57-.56,1.77-.56,2.29-.29,1.24.62,1.34,1.05.18.98.18.98l.48,1.27.29,1.46v1.24l.39,2.07s.16,1.64.16,2.29v1.05s.59-.07,1.34-.49,1.18-.29,1.18-.29l.58.07"/>
    </svg>
`;

function appendMessage(chatDiv, message, sender) {
    const div = document.createElement('div');
    div.className = `message ${sender}`;
    div.innerHTML = `<div class="avatar">${AVATAR_SVG}</div><div class="message-content"></div>`;
    div.querySelector('.message-content').textContent = message;
    chatDiv.appendChild(div);
    div.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

function showAlert(message) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 5000);
}

function handleAPIError(error) {
    console.error('API Error:', error);
    if (error.code === 'insufficient_quota' || error.code === 'credit_balance_exhausted') {
        showAlert('The AI service is out of credits right now. Please try again later.');
    } else if (error.status === 429) {
        showAlert('The AI service is busy. Please wait a moment and try again.');
    } else if (error.status === 403) {
        showAlert("Unable to reach the AI service. If you're on a corporate or school network, the connection may be blocked by a firewall.");
    } else {
        showAlert('An unexpected error occurred. Please try again later.');
    }
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

async function handleSubmit() {
    const themeInput = document.getElementById('theme-input');
    const theme = themeInput.value.trim();
    if (!theme) { showAlert('Please enter a theme for the exhibition.'); return; }
    if (!vectors) { showAlert('Please wait for the art data to finish loading.'); return; }

    themeInput.value = '';
    document.getElementById('chat-interface').style.display = 'block';
    document.querySelector('.input-section').classList.add('chat-started');
    console.log('Starting conversation with theme:', theme);
    await initiateConversation(theme);
}

document.querySelector('.submit-button').addEventListener('click', handleSubmit);
document.getElementById('theme-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') handleSubmit(); });

const helpButton = document.querySelector('.help-button');
const helpPopup = document.querySelector('.help-popup');
const [questionIcon, xIcon] = helpButton.querySelectorAll('svg');
const setHelp = (open) => {
    helpPopup.classList.toggle('show', open);
    questionIcon.style.display = open ? 'none' : 'block';
    xIcon.style.display = open ? 'block' : 'none';
};
helpButton.addEventListener('click', () => setHelp(!helpPopup.classList.contains('show')));
document.addEventListener('click', (e) => {
    if (!helpPopup.contains(e.target) && !helpButton.contains(e.target)) setHelp(false);
});

loadMuseumData();
