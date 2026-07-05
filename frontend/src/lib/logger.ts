import { getApiUrl } from './backendResolver';

/**
 * Sends a log message from the client to the backend to print in the Termux/Node console.
 * Helpful for debugging mobile devices remotely.
 */
export async function logToServer(level: 'INFO' | 'WARN' | 'ERROR', message: string, details?: any) {
  // Always print to the browser console
  const prefix = `[KokoClient][${level}]`;
  if (level === 'ERROR') {
    console.error(prefix, message, details ?? '');
  } else if (level === 'WARN') {
    console.warn(prefix, message, details ?? '');
  } else {
    console.log(prefix, message, details ?? '');
  }

  try {
    const apiBase = await getApiUrl();
    // Prepare serializable details if any
    let serializedDetails: any = undefined;
    if (details) {
      if (details instanceof Error) {
        serializedDetails = {
          name: details.name,
          message: details.message,
          stack: details.stack
        };
      } else {
        serializedDetails = details;
      }
    }

    await fetch(`${apiBase}/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level, message, details: serializedDetails }),
    });
  } catch (err) {
    // Avoid infinite loop if logging itself fails
  }
}
