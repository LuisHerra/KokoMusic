import play from 'play-dl';

async function test() {
  try {
    const url = 'https://www.youtube.com/watch?v=RHb5LKnnxLg';
    console.log('Fetching info...');
    const info = await play.video_info(url);
    console.log('Formats available:', info.format.length);
    
    // Print first 3 formats
    console.log(info.format.slice(0, 3));
  } catch (e) {
    console.error(e);
  }
}

test();
