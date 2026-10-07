import { EventEmitter } from 'node:events';

export function requireLoopback(value, protocols = ['http:']) {
  const url = new URL(value);
  if (!protocols.includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password) {
    throw new Error('The proof accepts only explicit loopback debugging endpoints.');
  }
  return url;
}

async function readJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(5000), redirect: 'error' });
  if (!response.ok) throw new Error(`Debugger discovery returned HTTP ${response.status}.`);
  return response.json();
}

export async function discover(endpoint) {
  const base = requireLoopback(endpoint);
  const [version, targets] = await Promise.all([
    readJson(new URL('/json/version', base)), readJson(new URL('/json/list', base)),
  ]);
  return { version, targets: targets.filter((target) => target.type === 'page') };
}

/** Select exactly one existing page. Never open, navigate, or close a user's target. */
export function selectTarget(targets, { targetId, targetUrl }) {
  if (!targetId && !targetUrl) throw new Error('Provide targetId or an exact targetUrl.');
  const matches = targets.filter((t) => (!targetId || t.id === targetId) && (!targetUrl || t.url === targetUrl));
  if (matches.length !== 1) throw new Error(`Expected one selected page; found ${matches.length}. Use targetId if URLs repeat.`);
  requireLoopback(matches[0].webSocketDebuggerUrl, ['ws:']);
  return matches[0];
}

export class CdpConnection extends EventEmitter {
  #socket;
  #nextId = 0;
  #pending = new Map();
  #closed = false;

  static async connect(url) {
    requireLoopback(url, ['ws:']);
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { socket.close(); reject(new Error('CDP connection timed out.')); }, 5000);
      socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP WebSocket connection failed.')); }, { once: true });
    });
    return new CdpConnection(socket);
  }

  constructor(socket) {
    super();
    this.#socket = socket;
    socket.addEventListener('message', ({ data }) => {
      let message;
      try { message = JSON.parse(data); } catch { this.close(); return; }
      if (message.id) {
        const pending = this.#pending.get(message.id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.#pending.delete(message.id);
        if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
        else pending.resolve(message.result ?? {});
      } else if (message.method) this.emit('event', message);
    });
    socket.addEventListener('close', () => this.#fail('CDP connection closed.'));
    socket.addEventListener('error', () => this.#fail('CDP connection failed.'));
  }

  send(method, params = {}, sessionId) {
    if (this.#closed) return Promise.reject(new Error('CDP connection is closed.'));
    if (this.#pending.size >= 64) return Promise.reject(new Error('Too many pending proof commands.'));
    const id = ++this.#nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`${method} timed out.`));
      }, 5000);
      this.#pending.set(id, { method, resolve, reject, timer });
      try { this.#socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); }
      catch (error) { clearTimeout(timer); this.#pending.delete(id); reject(error); }
    });
  }

  #fail(message) {
    this.#closed = true;
    for (const pending of this.#pending.values()) { clearTimeout(pending.timer); pending.reject(new Error(message)); }
    this.#pending.clear();
    this.emit('disconnected');
  }

  close() {
    if (this.#closed) return;
    this.#fail('CDP connection closed.');
    this.#socket.close();
  }
}

/** Track default worlds in the selected page and its related iframe sessions. */
export class FrameContexts {
  contexts = new Map();
  errors = [];
  #connection;
  #listener;
  #work = new Set();
  #active = true;

  constructor(connection) {
    this.#connection = connection;
    this.#listener = (event) => this.#onEvent(event);
    connection.on('event', this.#listener);
  }

  async start() { await this.#enable(undefined); }

  async #enable(sessionId) {
    await this.#connection.send('Runtime.enable', {}, sessionId);
    await this.#connection.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, sessionId);
  }

  #onEvent({ method, params, sessionId }) {
    if (!this.#active) return;
    if (method === 'Runtime.executionContextCreated' && params.context.auxData?.isDefault) {
      const context = params.context;
      this.contexts.set(`${sessionId ?? 'root'}:${context.id}`, { ...context, sessionId });
    } else if (method === 'Runtime.executionContextDestroyed') {
      this.contexts.delete(`${sessionId ?? 'root'}:${params.executionContextId}`);
    } else if (method === 'Runtime.executionContextsCleared' || method === 'Target.detachedFromTarget') {
      const retired = method === 'Target.detachedFromTarget' ? params.sessionId : sessionId;
      for (const [key, context] of this.contexts) if (context.sessionId === retired) this.contexts.delete(key);
    } else if (method === 'Target.attachedToTarget') {
      if (params.targetInfo.type !== 'iframe') return;
      const work = this.#enable(params.sessionId).catch((error) => this.errors.push(error.message));
      this.#work.add(work);
      work.finally(() => this.#work.delete(work));
    }
  }

  async evaluate(context, expression) {
    const key = `${context.sessionId ?? 'root'}:${context.id}`;
    if (this.contexts.get(key) !== context) throw new Error('The frame context has retired; rerun discovery.');
    const result = await this.#connection.send('Runtime.evaluate', {
      expression, ...(context.uniqueId ? { uniqueContextId: context.uniqueId } : { contextId: context.id }), returnByValue: true, awaitPromise: true,
    }, context.sessionId);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    if (this.contexts.get(key) !== context) throw new Error('The frame changed during evaluation.');
    return result.result.value;
  }

  async settle() { await Promise.all([...this.#work]); }
  stop() { this.#active = false; this.#connection.off('event', this.#listener); this.contexts.clear(); }
}
