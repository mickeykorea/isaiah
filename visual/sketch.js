let song;
let lyrics = [];
let isPlaying = false;

let inputText = '';
let textPositions = [];
let currentLyrics = [];
let currentLyricIndex = 0;
let timeForNextLyric = 0;
let displayDuration = 5000;
let transitionDuration = 1000;

function preload() {
    song = loadSound('./assets/you.mp3');
    loadJSON('./assets/you.json', function (data) {
        // Convert all lyrics text to uppercase
        lyrics = data.map(lyric => ({
            text: lyric.text.toUpperCase(),
            time: lyric.time
        }));
    });
}

function setup() {
    createCanvas(windowWidth, windowHeight);
    colorMode(HSB, 360, 100, 100);

    // Song Lyrics with timestamps = Lyricsify.com
    // currentLyrics = [
    //     "HELLO WORLD",
    //     "THIS IS A TEST",
    // ];

    // Add play button
    let playButton = createButton('Play/Pause');
    playButton.position(20, 20);
    playButton.mousePressed(togglePlay);
}

function draw() {
    background(0);
    updateLyrics();

    // Set text properties
    textSize(32);
    textAlign(CENTER, CENTER);
    fill('rgba(255, 99, 71, 0.8)');

    // Calculate grid spacing based on letter size
    let gridSpaceX = 40;
    let gridSpaceY = 40;

    // Create grid of letters
    for (let x = gridSpaceX / 2; x < width; x += gridSpaceX) {
        for (let y = gridSpaceY / 2; y < height; y += gridSpaceY) {
            let forcedLetter = getInputLetterForPosition(x, y);
            if (forcedLetter) {
                fill('rgba(255, 255, 255, 0.8)');  // White for lyrics
                glow('white', 50);
            } else {
                fill('rgba(255, 99, 71, 0.8)');    // Tomato for random letters
                glow('tomato', 50);
            }
            gridText(x, y, forcedLetter);
        }
    }
}

function gridText(x, y, forcedLetter) {
    // Generate random letter (A-Z)
    if (forcedLetter) {
        this[`letter_${x}_${y}`] = forcedLetter;
    } else if (!this[`letter_${x}_${y}`] || random() < 0.01) {  // 1% chance to change
        this[`letter_${x}_${y}`] = String.fromCharCode(65 + floor(random(26)));
    }
    text(this[`letter_${x}_${y}`], x, y);
}

function glow(glowColor, blurriness) {
    drawingContext.shadowBlur = blurriness;
    drawingContext.shadowColor = glowColor;
}

// function updateLyrics() {
//     let currentTime = millis();

//     if (currentTime > timeForNextLyric) {
//         // Move to next lyric
//         if (currentLyricIndex < currentLyrics.length) {
//             inputText = currentLyrics[currentLyricIndex];
//             generateTextPositions(currentTime);
//             currentLyricIndex++;
//             timeForNextLyric = currentTime + displayDuration;
//         } else {
//             // Reset or loop lyrics
//             currentLyricIndex = 0;
//             inputText = '';
//             textPositions = [];
//         }
//     }
// }

function updateLyrics() {
    if (!isPlaying) return;

    let currentTime = song.currentTime() * 1000; // Convert to milliseconds

    // Check if it's time for the next lyric
    if (currentLyricIndex < lyrics.length &&
        currentTime >= lyrics[currentLyricIndex].time) {
        inputText = lyrics[currentLyricIndex].text;
        generateTextPositions(millis());  // Use millis() for transition timing
        currentLyricIndex++;
    }

    // Clear text after display duration
    if (currentLyricIndex > 0 &&
        currentTime >= lyrics[currentLyricIndex - 1].time + displayDuration) {
        inputText = '';
        textPositions = [];
    }

    // Reset if song ends
    if (currentTime >= song.duration() * 1000) {
        currentLyricIndex = 0;
        inputText = '';
        textPositions = [];
        isPlaying = false;
    }
}

function generateTextPositions(startTime) {
    textPositions = [];
    let gridSpaceX = 40;
    let gridSpaceY = 40;

    // Split input text into words
    let words = inputText.split(" ");

    // Divide the screen height into sections based on number of words
    let sectionHeight = height / words.length;

    // Keep track of the previous word's position
    let prevWordEnd = null;

    // Place each word
    words.forEach((word, wordIndex) => {
        // Calculate the vertical bounds for this word's section
        let sectionTop = sectionHeight * wordIndex;
        let sectionBottom = sectionHeight * (wordIndex + 1);

        // Get possible positions for this section
        let sectionPositions = [];
        for (let y = gridSpaceY / 2; y < height - gridSpaceY; y += gridSpaceY) {
            // Only include positions within this word's vertical section
            if (y >= sectionTop && y < sectionBottom) {
                for (let x = gridSpaceX / 2; x < width - gridSpaceX; x += gridSpaceX) {
                    sectionPositions.push({ x, y });
                }
            }
        }

        if (sectionPositions.length === 0) return;

        // Find positions with enough space for the word
        let validPositions = sectionPositions.filter(pos =>
            pos.x + (word.length * gridSpaceX) <= width - gridSpaceX / 2
        );

        if (validPositions.length === 0) return;

        let wordPos;
        if (prevWordEnd) {
            // Find positions that are within a reasonable distance
            let possiblePositions = validPositions.filter(pos => {
                let dx = Math.abs(pos.x - prevWordEnd.x);
                let dy = Math.abs(pos.y - prevWordEnd.y);
                // Allow more variation in positioning:
                // - Horizontal: up to 6 grid spaces in either direction
                // - Vertical: 1-4 grid spaces up or down
                return dx <= gridSpaceX * 6 && dy >= gridSpaceY && dy <= gridSpaceY * 4;
            });

            if (possiblePositions.length > 0) {
                // Add some randomness to direction preference
                if (random() < 0.4) {  // 40% chance to prefer left side
                    let leftPositions = possiblePositions.filter(pos => pos.x < prevWordEnd.x);
                    if (leftPositions.length > 0) {
                        possiblePositions = leftPositions;
                    }
                }

                // Take up to 8 random positions for more variation
                let candidates = [];
                for (let i = 0; i < min(8, possiblePositions.length); i++) {
                    let randomIndex = floor(random(possiblePositions.length));
                    candidates.push(possiblePositions[randomIndex]);
                    possiblePositions.splice(randomIndex, 1);
                }

                // 60% chance to pick closest position, 40% chance for random
                if (random() < 0.6) {
                    wordPos = candidates.reduce((closest, current) => {
                        let currentDist = dist(current.x, current.y, prevWordEnd.x, prevWordEnd.y);
                        let closestDist = dist(closest.x, closest.y, prevWordEnd.x, prevWordEnd.y);
                        return currentDist < closestDist ? current : closest;
                    });
                } else {
                    // 40% chance to pick a random candidate
                    wordPos = candidates[floor(random(candidates.length))];
                }
            } else {
                // If no good positions found, find the closest valid position
                wordPos = validPositions[floor(random(validPositions.length))];
            }
        } else {
            // For first word, start near the top-center of its section
            let centerPositions = validPositions.filter(pos => {
                let horizontalCenter = abs(pos.x - width / 2) < width / 4;
                let nearTop = pos.y - sectionTop < sectionHeight / 3;
                return horizontalCenter && nearTop;
            });
            wordPos = centerPositions.length > 0 ?
                centerPositions[floor(random(centerPositions.length))] :
                validPositions[floor(random(validPositions.length))];
        }

        // Add positions for each letter in the word
        for (let i = 0; i < word.length; i++) {
            textPositions.push({
                x: wordPos.x + (i * gridSpaceX),
                y: wordPos.y,
                startTime: startTime + random(transitionDuration)
            });
        }

        // Update the previous word end position
        prevWordEnd = {
            x: wordPos.x + (word.length * gridSpaceX),
            y: wordPos.y
        };
    });
}

function getInputLetterForPosition(x, y) {
    let currentTime = millis();
    let textWithoutSpaces = inputText.replace(/\s+/g, '');  // Remove all spaces

    for (let i = 0; i < textPositions.length; i++) {
        if (textPositions[i].x === x && textPositions[i].y === y) {
            // Only show the letter if its transition time has come
            if (currentTime >= textPositions[i].startTime) {
                return textWithoutSpaces[i];
            }
            return null;
        }
    }
    return null;
}

function togglePlay() {
    if (!isPlaying) {
        song.play();
        isPlaying = true;
        currentLyricIndex = 0;
        inputText = '';
        textPositions = [];
    } else {
        song.pause();
        isPlaying = false;
    }
}

