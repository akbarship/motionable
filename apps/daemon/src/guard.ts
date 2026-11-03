// Only this computer may talk to the daemon. It listens on 127.0.0.1, but a web page can still reach it: through
// DNS rebinding (a foreign name pointing at 127.0.0.1, so the Host is wrong) or a cross-site request (the Origin is
// wrong). Either could start Claude, change the keys or spend the user's ElevenLabs credit, so both are refused.
import type {FastifyInstance} from 'fastify';

const LOCAL = new Set(['127.0.0.1', 'localhost', '[::1]']);

const hostname = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
};

/** A Host header naming this computer (any port: the Studio's dev server proxies with its own). */
export const allowedHost = (host: string | undefined) => !!host && LOCAL.has(hostname(`http://${host}`) ?? '');

/** No Origin (the MCP shim, curl, a plain page load) or a page served from this computer. */
export const allowedOrigin = (origin: string | undefined) =>
  origin === undefined || (origin.startsWith('http://') && LOCAL.has(hostname(origin) ?? ''));

export const guard = (app: FastifyInstance) =>
  app.addHook('onRequest', (req, reply, done) => {
    const h = req.headers;
    if (!allowedHost(h.host) || !allowedOrigin(h.origin) || h['sec-fetch-site'] === 'cross-site')
      return reply.code(403).send({error: 'forbidden host'});
    done();
  });
