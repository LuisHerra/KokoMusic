const fs = require('fs');
const text = fs.readFileSync('spotify_html.txt', 'utf8');

const titleMatch = text.match(/<meta property="og:title" content="(.*?)"/);
console.log('Title:', titleMatch ? titleMatch[1] : 'not found');

const songs = text.split('<meta name="music:song" content="');
console.log('Songs found:', songs.length - 1);

// Spotify actually stores the full list in a Redux state or next_data
const stateMatch = text.match(/<script id="initial-state" type="application\/json">(.*?)<\/script>/) || text.match(/<script type="application\/json" id="__NEXT_DATA__">(.*?)<\/script>/);

if (stateMatch) {
    console.log('State match length:', stateMatch[1].length);
    // console.log(stateMatch[1].substring(0, 200));
} else {
    console.log('No state match found. Looking for other JSON objects in script tags...');
    const matchJson = text.match(/<script[^>]*>.*?({".*?}).*?<\/script>/s);
    if (matchJson) {
        // console.log('Found generic json:', matchJson[1].substring(0, 100));
    }
}
