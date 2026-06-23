export interface LyricsLine {
  time: number;
  text: string;
}

export interface LyricSection {
  id: number;
  startTime: number;
  lines: number[];
  type: string;
}

export function parseSyncedLyrics(synced: string | null): LyricsLine[] {
  if (!synced) return [];
  const lines = synced.split('\n');
  const result: LyricsLine[] = [];
  
  // Formato: [mm:ss.xx] Letra
  const regex = /\[(\d+):(\d+)(?:\.(\d+))?\](.*)/;

  for (const line of lines) {
    const match = line.match(regex);
    if (match) {
      const min = parseInt(match[1], 10);
      const sec = parseInt(match[2], 10);
      const ms = match[3] ? parseInt(match[3].padEnd(3, '0').slice(0, 3), 10) : 0;
      const time = min * 60 + sec + ms / 1000;
      const text = match[4].trim();
      if (text) {
        result.push({ time, text });
      }
    }
  }
  
  return result;
}

export function detectLyricSections(parsedLines: LyricsLine[]): LyricSection[] {
  if (parsedLines.length === 0) return [];
  
  const secs: LyricSection[] = [];
  let currentSection = { id: 0, startTime: parsedLines[0].time, lines: [0], type: '' };
  
  for (let i = 1; i < parsedLines.length; i++) {
    const line = parsedLines[i];
    const prevLine = parsedLines[i - 1];
    const timeDiff = line.time - prevLine.time;
    
    if (timeDiff >= 6.5) {
      secs.push(currentSection);
      currentSection = { id: secs.length, startTime: line.time, lines: [i], type: '' };
    } else {
      currentSection.lines.push(i);
    }
  }
  secs.push(currentSection);
  
  for (let i = 0; i < secs.length; i++) {
     const textI = secs[i].lines.map(l => parsedLines[l].text).join(' ').substring(0, 40).toLowerCase();
     if (textI.length < 15) continue;
     for (let j = i + 1; j < secs.length; j++) {
        const textJ = secs[j].lines.map(l => parsedLines[l].text).join(' ').substring(0, 40).toLowerCase();
        if (textI === textJ) {
           secs[i].type = 'Estribillo';
           secs[j].type = 'Estribillo';
        }
     }
  }
  
  let verseCount = 1;
  secs.forEach((s, idx) => {
     if (s.type === 'Estribillo') return;
     if (idx === 0) s.type = 'Intro';
     else if (idx === secs.length - 1 && s.lines.length <= 4) s.type = 'Outro';
     else s.type = 'Verso ' + verseCount++;
  });

  return secs;
}
