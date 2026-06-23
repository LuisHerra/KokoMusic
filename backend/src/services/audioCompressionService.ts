import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';

const execAsync = promisify(exec);

const AUDIO_BITRATE = process.env.AUDIO_BITRATE ?? '96k';
const AUDIO_VBR = process.env.AUDIO_VBR !== 'false';
const AUDIO_COMPRESSION_LEVEL = parseInt(process.env.AUDIO_COMPRESSION_LEVEL ?? '10', 10);
const AUDIO_SAMPLE_RATE = process.env.AUDIO_SAMPLE_RATE ?? '48000';

/**
 * Comprime un archivo de audio de entrada a formato Opus altamente eficiente utilizando FFmpeg.
 * Aplica normalización EBU R128 (-14 LUFS) para consistencia de volumen.
 * 
 * @param inputPath Ruta al archivo de audio original
 * @returns Ruta al archivo transcodificado (.opus), o la ruta original si falla
 */
export async function compressAudio(inputPath: string): Promise<string> {
  if (!fs.existsSync(inputPath)) {
    console.error(`[AudioCompression] Archivo no encontrado: ${inputPath}`);
    return inputPath;
  }

  const ext = path.extname(inputPath);
  // Si ya es .opus, no es necesario volver a comprimir
  if (ext.toLowerCase() === '.opus') {
    return inputPath;
  }

  const dir = path.dirname(inputPath);
  const baseName = path.basename(inputPath, ext);
  const outputPath = path.join(dir, `${baseName}.opus`);

  console.log(`[AudioCompression] Iniciando compresión de: ${inputPath} -> ${outputPath}`);
  
  const ffmpegCmd = [
    'ffmpeg',
    '-i', `"${inputPath}"`,
    '-c:a', 'libopus',
    '-b:a', AUDIO_BITRATE,
    '-vbr', AUDIO_VBR ? 'on' : 'off',
    '-compression_level', String(AUDIO_COMPRESSION_LEVEL),
    '-ar', AUDIO_SAMPLE_RATE,
    '-ac', '2',
    '-af', 'loudnorm=I=-14:LRA=11:TP=-1.5',
    '-y',
    `"${outputPath}"`,
  ].join(' ');

  try {
    await execAsync(ffmpegCmd);

    if (fs.existsSync(outputPath)) {
      const origStats = fs.statSync(inputPath);
      const newStats = fs.statSync(outputPath);
      const origMB = (origStats.size / 1024 / 1024).toFixed(2);
      const newMB = (newStats.size / 1024 / 1024).toFixed(2);
      
      console.log(`[AudioCompression] ✅ Compresión exitosa: ${origMB} MB -> ${newMB} MB (Ahorro del ${(((origStats.size - newStats.size) / origStats.size) * 100).toFixed(1)}%)`);

      // Eliminar el archivo original
      fs.unlinkSync(inputPath);
      return outputPath;
    } else {
      throw new Error('El archivo de salida no fue creado por FFmpeg');
    }
  } catch (error) {
    console.error(`[AudioCompression] ❌ Error comprimiendo audio con FFmpeg, usando fallback original:`, error);
    return inputPath;
  }
}
