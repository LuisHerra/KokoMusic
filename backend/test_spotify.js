const spotifyUrlInfo = require('spotify-url-info')(fetch);

async function test() {
  try {
    const data = await spotifyUrlInfo.getTracks('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M');
    console.log(`Found ${data.length} tracks.`);
    if (data.length > 0) {
      console.log('First track:', data[0].name, 'by', data[0].artists[0].name);
    }
  } catch (err) {
    console.error('Error fetching spotify playlist:', err.message);
  }
}
test();
