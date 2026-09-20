/**
 * http-proxy-agent / https-proxy-agent publican tipos solo vía el campo
 * "exports" del package.json, que el moduleResolution "node" clásico de
 * este proyecto no sabe resolver (funcionan bien en runtime — esto es solo
 * para que tsc encuentre los tipos sin cambiar la resolución del proyecto
 * entero).
 */
declare module 'http-proxy-agent' {
  import { Agent } from 'http';
  export class HttpProxyAgent extends Agent {
    constructor(proxy: string, opts?: Record<string, unknown>);
  }
}

declare module 'https-proxy-agent' {
  import { Agent } from 'https';
  export class HttpsProxyAgent extends Agent {
    constructor(proxy: string, opts?: Record<string, unknown>);
  }
}
