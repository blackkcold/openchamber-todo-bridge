(() => {
  // node_modules/@openchamber/sdk/dist/api-version.js
  var OPENCHAMBER_SDK_CHANNEL = "openchamber.sdk";
  var OPENCHAMBER_SDK_API_VERSION = 1;
  // node_modules/@openchamber/sdk/dist/scrollbar-style.js
  var GUEST_SCROLLING_ATTRIBUTE = "data-oc-scrolling";
  var GUEST_SCROLLBAR_CSS = `
:root {
  --oc-scrollbar-thumb: color-mix(in srgb, var(--oc-muted, currentColor) 40%, transparent);
  --oc-scrollbar-thumb-hover: color-mix(in srgb, var(--oc-muted, currentColor) 65%, transparent);
  scrollbar-gutter: stable;
}
* {
  scrollbar-width: thin;
  scrollbar-color: transparent transparent;
}
:hover, [${GUEST_SCROLLING_ATTRIBUTE}] {
  scrollbar-color: var(--oc-scrollbar-thumb) transparent;
}
/* Chromium's standard scrollbar properties otherwise override its pseudo-elements. */
@supports selector(::-webkit-scrollbar) {
  *, :hover, [${GUEST_SCROLLING_ATTRIBUTE}] { scrollbar-width: auto; scrollbar-color: auto; }
  ::-webkit-scrollbar { width: 6px; height: 6px; background: transparent; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb {
    background: transparent;
    border-radius: 999px;
    min-width: 24px;
    min-height: 24px;
  }
  :hover::-webkit-scrollbar-thumb, [${GUEST_SCROLLING_ATTRIBUTE}]::-webkit-scrollbar-thumb { background: var(--oc-scrollbar-thumb); }
  ::-webkit-scrollbar-thumb:hover { background: var(--oc-scrollbar-thumb-hover); }
  ::-webkit-scrollbar-corner { background: transparent; }
  ::-webkit-scrollbar-button { display: none; width: 0; height: 0; }
}
@media (forced-colors: active) {
  *, :hover, [${GUEST_SCROLLING_ATTRIBUTE}] { scrollbar-color: auto; }
  ::-webkit-scrollbar-thumb, ::-webkit-scrollbar-thumb:hover { background: CanvasText; }
}
`;
  function installGuestScrollbarActivity(doc) {
    const root = doc.documentElement;
    if (root.hasAttribute("data-oc-scrollbar-activity"))
      return;
    root.setAttribute("data-oc-scrollbar-activity", "");
    const timers = new WeakMap;
    doc.addEventListener("scroll", (event) => {
      const target = event.target === doc ? root : event.target;
      if (!(target instanceof Element))
        return;
      if (!target.hasAttribute("data-oc-scrolling"))
        target.setAttribute("data-oc-scrolling", "");
      const pending = timers.get(target);
      if (pending !== undefined)
        clearTimeout(pending);
      timers.set(target, setTimeout(() => {
        timers.delete(target);
        target.removeAttribute("data-oc-scrolling");
      }, 1000));
    }, { capture: true, passive: true });
  }
  var GUEST_SCROLLBAR_SCRIPT = `(${installGuestScrollbarActivity.toString()})(document);`;
  // node_modules/@openchamber/sdk/dist/workspace.js
  var GUEST_STORAGE_KEY_MAX = 128;
  var GUEST_STORAGE_VALUE_BYTES = 65536;
  // node_modules/@openchamber/sdk/dist/file-editor.js
  var GUEST_FILE_EDITOR_CONTENT_MAX = 20000000;
  var GUEST_FILE_EDITOR_VERSION_MAX = 256;
  var patternExpressions = new Map;
  var fileEditorPayloadSize = (value) => ("bytes" in value) ? value.bytes.byteLength : value.content.length;
  var sameFileEditorDocument = (left, right) => {
    if (left.path !== right.path || left.readOnly !== right.readOnly)
      return false;
    if (left.encoding === "text" || right.encoding === "text") {
      return left.encoding === "text" && right.encoding === "text" && left.content === right.content;
    }
    if (left.bytes.byteLength !== right.bytes.byteLength)
      return false;
    for (let index = 0;index < left.bytes.byteLength; index += 1) {
      if (left.bytes[index] !== right.bytes[index])
        return false;
    }
    return true;
  };
  // node_modules/@openchamber/sdk/dist/contract.js
  var GUEST_FILE_STAT_KINDS = ["file", "directory", "other", "missing"];
  var isStartSessionResult = (value) => Boolean(value && "sessionId" in value);
  var isPromptResult = (value) => Boolean(value && "sent" in value && !("sessionId" in value));
  var GUEST_COMMIT_SHA = /^[0-9a-f]{7,64}$/i;
  var isGuestCommitSha = (value) => GUEST_COMMIT_SHA.test(value);
  var GUEST_TOAST_MAX = 500;
  var GUEST_CLIPBOARD_TEXT_MAX = 32000;
  var GUEST_COMPOSE_TEXT_MAX = 16000;
  var GUEST_ATTACH_ID_MAX = 128;
  var GUEST_ATTACH_TITLE_MAX = 200;
  var GUEST_ATTACH_URL_MAX = 2000;
  var GUEST_ATTACH_TEXT_MAX = 16000;
  var GUEST_ATTACH_AUTHOR_MAX = 80;
  var GUEST_ATTACH_BRANCH_MAX = 200;
  var GUEST_ATTACH_DATA_MAX = 16000;
  var GUEST_REQUEST_PATH_MAX = 2000;
  var GUEST_REQUEST_TIMEOUT_MS = 20000;
  var GUEST_FILE_PATH_MAX = 1024;
  var GUEST_FILE_CONTENT_MAX = 2000000;
  var GUEST_GENERATE_PROMPT_MAX = 64000;
  var GUEST_GENERATE_SYSTEM_MAX = 8000;
  var GUEST_GENERATE_OUTPUT_TOKENS_MAX = 4000;
  var GUEST_GENERATE_TIMEOUT_MS = 90000;
  var GUEST_BADGE_MAX = 999;
  var GUEST_FRAME_HEIGHT_MAX = 1e4;
  var GUEST_RESOLVE_ERROR_MAX = 500;
  var HOST_REQUEST_ERROR_CODES = [
    "HOST_UNAVAILABLE",
    "HOST_TIMEOUT",
    "HOST_REJECTED",
    "DISCONNECTED",
    "DISABLED",
    "BAD_PATH",
    "NO_INTEGRATION",
    "NO_SERVICE",
    "SERVICE_FAILED",
    "NO_SESSION",
    "SESSION_BUSY",
    "NOT_GRANTED",
    "NO_DIRECTORY",
    "NOT_FOUND",
    "FILE_TOO_LARGE",
    "DENIED",
    "NO_MODEL",
    "MODEL_FAILED",
    "UNSUPPORTED"
  ];
  var SERVICE_STATUS_VALUES = ["stopped", "starting", "ready", "failed"];
  var hostRequestErrorCodeSet = new Set(HOST_REQUEST_ERROR_CODES);
  var isHostRequestErrorCode = (value) => hostRequestErrorCodeSet.has(value);
  var resolveHostRequestErrorCode = (value) => value && isHostRequestErrorCode(value) ? value : "HOST_REJECTED";
  var isJsonValue = (value) => {
    if (value === undefined)
      return false;
    if (value === null || value === true || value === false)
      return true;
    if (String(value) === value)
      return true;
    if (Number(value) === value)
      return Number.isFinite(value);
    if (Array.isArray(value))
      return value.every(isJsonValue);
    if (Object(value) === value)
      return Object.values(value).every(isJsonValue);
    return false;
  };
  var isAttachData = (value) => isJsonValue(value) && JSON.stringify(value).length <= GUEST_ATTACH_DATA_MAX;
  var clampBranch = (value) => value?.trim().slice(0, GUEST_ATTACH_BRANCH_MAX) ?? "";
  var clampAttachRequest = (request) => {
    const id = request.id.trim().slice(0, GUEST_ATTACH_ID_MAX);
    const title = request.title.trim().slice(0, GUEST_ATTACH_TITLE_MAX);
    const url = request.url.trim().slice(0, GUEST_ATTACH_URL_MAX);
    const text = request.text?.trim().slice(0, GUEST_ATTACH_TEXT_MAX);
    const author = request.author?.trim().slice(0, GUEST_ATTACH_AUTHOR_MAX);
    const kind = request.kind === "pull" ? "pull" : "issue";
    const next = {
      providerId: request.providerId.trim(),
      id,
      title: title || id,
      url,
      kind
    };
    if (text) {
      next.text = text;
    }
    if (author) {
      next.author = author;
    }
    if (kind === "pull") {
      const head = clampBranch(request.branches?.head);
      const base = clampBranch(request.branches?.base);
      if (head && base) {
        next.branches = { head, base };
      }
    }
    if (isAttachData(request.data)) {
      next.data = request.data;
    }
    return next;
  };
  var clampStartSessionRequest = (request) => {
    const next = clampAttachRequest(request);
    if (request.projectId)
      next.projectId = request.projectId;
    if (request.navigation)
      next.navigation = request.navigation;
    if (request.worktree) {
      next.worktree = request.worktree;
    }
    return next;
  };
  var clampPromptRequest = (request) => {
    const next = {
      text: request.text.trim().slice(0, GUEST_COMPOSE_TEXT_MAX)
    };
    if (request.send) {
      next.send = true;
    }
    return next;
  };
  var clampBadgeCount = (count) => {
    if (count === null || !Number.isFinite(count))
      return null;
    return Math.min(GUEST_BADGE_MAX, Math.max(0, Math.round(count)));
  };
  var clampFrameHeight = (height) => {
    if (!Number.isFinite(height))
      return 0;
    return Math.min(GUEST_FRAME_HEIGHT_MAX, Math.max(0, Math.ceil(height)));
  };
  var isGuestFilePath = (value) => value.length > 0 && value.length <= GUEST_FILE_PATH_MAX && !value.includes("\x00") && !value.includes("\\");
  var isGuestRequestPath = (value) => {
    if (!value.startsWith("/") || value.includes("\x00") || value.includes("\\") || value.includes("://")) {
      return false;
    }
    if (value.length > GUEST_REQUEST_PATH_MAX) {
      return false;
    }
    const segments = value.split("/");
    return !segments.some((segment) => segment === "." || segment === "..");
  };
  var serviceStatusSet = new Set(SERVICE_STATUS_VALUES);
  var isServiceStatusResult = (value) => Boolean(value && "status" in value && serviceStatusSet.has(String(value.status)) && !("body" in value));
  var isGuestRequestResult = (value) => Boolean(value && "status" in value && "body" in value && Number.isInteger(value.status));
  var isFileReadResult = (value) => Boolean(value && "content" in value && String(value.content) === value.content);
  var isFileWriteResult = (value) => Boolean(value && "written" in value && value.written === true);
  var isFileListResult = (value) => Boolean(value && "entries" in value && Array.isArray(value.entries));
  var fileStatKindSet = new Set(GUEST_FILE_STAT_KINDS);
  var isFileStatResult = (value) => Boolean(value && "kind" in value && "size" in value && fileStatKindSet.has(String(value.kind)) && Number.isFinite(value.size));
  var isGenerateResult = (value) => Boolean(value && "text" in value && String(value.text) === value.text && !("status" in value));
  var HOST_PUSH_TYPES = new Set([
    "workspace",
    "ready",
    "directory",
    "session",
    "connection",
    "settings",
    "session-lifecycle",
    "item",
    "resolve",
    "action",
    "file-open",
    "file-snapshot",
    "file-saved"
  ]);
  var asWireRecord = (data) => Object(data) === data ? data : null;
  var isNonEmptyString = (value) => String(value) === value && value.length > 0;
  var readResultMessage = (wire) => {
    if (!isNonEmptyString(wire.id))
      return null;
    if (wire.ok === true) {
      const message = {
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "result",
        id: wire.id,
        ok: true
      };
      if (Object(wire.payload) === wire.payload) {
        message.payload = wire.payload;
      }
      return message;
    }
    if (wire.ok === false && isNonEmptyString(wire.error)) {
      return {
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "result",
        id: wire.id,
        ok: false,
        error: wire.error,
        code: resolveHostRequestErrorCode(isNonEmptyString(wire.code) ? wire.code : undefined)
      };
    }
    return null;
  };
  var readHostMessage = (data) => {
    const wire = asWireRecord(data);
    if (!wire || wire.channel !== OPENCHAMBER_SDK_CHANNEL || wire.v !== OPENCHAMBER_SDK_API_VERSION)
      return null;
    if (wire.type === "result")
      return readResultMessage(wire);
    if (!HOST_PUSH_TYPES.has(String(wire.type)) || Object(wire.payload) !== wire.payload)
      return null;
    return wire;
  };

  // node_modules/@openchamber/sdk/dist/host.js
  var isKeyEvent = (event) => ("key" in event) && ("metaKey" in event) && ("ctrlKey" in event);
  var isSaveShortcut = (event) => (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "s";

  class HostRequestError extends Error {
    code;
    constructor(code, message) {
      super(message);
      this.name = "HostRequestError";
      this.code = code;
    }
  }
  var rejectBadPath = () => Promise.reject(new HostRequestError("BAD_PATH", 'Request path must start with "/" and stay on the declared origin.'));
  var rejectBadFilePath = () => Promise.reject(new HostRequestError("BAD_PATH", `File path must be 1 to ${GUEST_FILE_PATH_MAX} characters without NUL or backslash.`));
  var nextId = (n) => {
    n.value += 1;
    return `oc-${n.value}`;
  };
  var connectHost = (options = {}) => {
    const target = options.target ?? ("window" in globalThis ? window : null);
    if (!target) {
      throw new HostRequestError("HOST_UNAVAILABLE", "No window. connectHost runs in a browser frame.");
    }
    const acceptSource = options.acceptSource ?? ((source) => source === target.parent);
    const requestTimeoutMs = options.requestTimeoutMs ?? GUEST_REQUEST_TIMEOUT_MS;
    const readyListeners = new Set;
    const directoryListeners = new Set;
    const sessionListeners = new Set;
    const lifecycleListeners = new Set;
    const connectionListeners = new Set;
    const settingsListeners = new Set;
    const itemListeners = new Set;
    let resolveHandler = null;
    let actionHandler = null;
    const fileOpenListeners = new Set;
    const fileSavedListeners = new Set;
    let fileSnapshotHandler = null;
    let lastFile = null;
    let saveShortcutInstalled = false;
    const pending = new Map;
    const workspaceListeners = new Map;
    let disposed = false;
    const ids = { value: 0 };
    let lastReady = null;
    let lastLifecycle = null;
    const lifecycleFromSession = (session) => {
      if (!session)
        return null;
      return {
        sessionId: session.id,
        phase: session.busy ? "started" : "completed"
      };
    };
    const post = (message) => {
      target.parent.postMessage(message, "*");
    };
    const emit = (listeners, value) => {
      for (const listener of listeners) {
        try {
          listener(value);
        } catch (error) {
          console.error(error);
        }
      }
    };
    const onMessage = (event) => {
      if (!(event instanceof MessageEvent))
        return;
      if (!acceptSource(event.source))
        return;
      const message = readHostMessage(event.data);
      if (!message)
        return;
      if (message.type === "workspace") {
        const listener = workspaceListeners.get(message.payload.subscriptionId);
        if (listener)
          emit([listener], message.payload.snapshot);
        return;
      }
      if (message.type === "ready") {
        lastReady = message.payload;
        lastLifecycle = lifecycleFromSession(message.payload.session);
        emit(readyListeners, message.payload);
        emit(directoryListeners, message.payload.directory);
        emit(sessionListeners, message.payload.session);
        if (lastLifecycle) {
          emit(lifecycleListeners, lastLifecycle);
        }
        emit(connectionListeners, message.payload.connection);
        emit(settingsListeners, message.payload.settings);
        emit(itemListeners, message.payload.item);
        return;
      }
      if (message.type === "directory") {
        if (lastReady) {
          lastReady = { ...lastReady, directory: message.payload.directory };
        }
        emit(directoryListeners, message.payload.directory);
        return;
      }
      if (message.type === "session") {
        if (lastReady) {
          lastReady = { ...lastReady, session: message.payload.session };
        }
        if (!message.payload.session) {
          lastLifecycle = null;
        } else if (lastLifecycle?.sessionId !== message.payload.session.id) {
          lastLifecycle = lifecycleFromSession(message.payload.session);
        }
        emit(sessionListeners, message.payload.session);
        return;
      }
      if (message.type === "session-lifecycle") {
        lastLifecycle = message.payload;
        emit(lifecycleListeners, message.payload);
        return;
      }
      if (message.type === "connection") {
        if (lastReady) {
          lastReady = { ...lastReady, connection: message.payload.connection };
        }
        emit(connectionListeners, message.payload.connection);
        return;
      }
      if (message.type === "settings") {
        if (lastReady) {
          lastReady = { ...lastReady, settings: message.payload.settings };
        }
        emit(settingsListeners, message.payload.settings);
        return;
      }
      if (message.type === "item") {
        if (lastReady) {
          lastReady = { ...lastReady, item: message.payload.item };
        }
        emit(itemListeners, message.payload.item);
        return;
      }
      if (message.type === "action") {
        const answer = (payload) => {
          if (!disposed)
            post({
              channel: OPENCHAMBER_SDK_CHANNEL,
              v: OPENCHAMBER_SDK_API_VERSION,
              type: "action-result",
              id: message.id,
              payload
            });
        };
        const handler = actionHandler;
        if (!handler) {
          answer({ ok: false, error: "This extension does not handle background actions." });
          return;
        }
        Promise.resolve().then(() => handler(message.payload)).then(() => answer({ ok: true }), (error) => {
          const text = (error instanceof Error ? error.message : String(error)).trim();
          answer({ ok: false, error: (text || "Action failed.").slice(0, GUEST_RESOLVE_ERROR_MAX) });
        });
        return;
      }
      if (message.type === "file-open") {
        const next = message.payload;
        if (lastFile && sameFileEditorDocument(lastFile, next))
          return;
        lastFile = next;
        emit(fileOpenListeners, message.payload);
        return;
      }
      if (message.type === "file-saved") {
        emit(fileSavedListeners, message.payload.version);
        return;
      }
      if (message.type === "file-snapshot") {
        const answer = (payload) => {
          if (!disposed)
            post({
              channel: OPENCHAMBER_SDK_CHANNEL,
              v: OPENCHAMBER_SDK_API_VERSION,
              type: "file-snapshot-result",
              id: message.id,
              payload
            });
        };
        const fail = (text) => answer({ error: (text.trim() || "Could not read the edited file.").slice(0, GUEST_RESOLVE_ERROR_MAX) });
        const handler = fileSnapshotHandler;
        if (!handler) {
          fail("This extension does not edit files.");
          return;
        }
        Promise.resolve().then(() => handler(message.payload.purpose)).then((snapshot) => {
          if (fileEditorPayloadSize(snapshot) > GUEST_FILE_EDITOR_CONTENT_MAX) {
            fail(`The file is over ${GUEST_FILE_EDITOR_CONTENT_MAX} ${"bytes" in snapshot ? "bytes" : "characters"}.`);
            return;
          }
          if (snapshot.version.length > GUEST_FILE_EDITOR_VERSION_MAX) {
            fail(`The snapshot version is over ${GUEST_FILE_EDITOR_VERSION_MAX} characters.`);
            return;
          }
          answer({ snapshot: "bytes" in snapshot ? { bytes: snapshot.bytes, version: snapshot.version } : { content: snapshot.content, version: snapshot.version } });
        }, (error) => fail(error instanceof Error ? error.message : String(error)));
        return;
      }
      if (message.type === "resolve") {
        const answer = (payload) => {
          post({
            channel: OPENCHAMBER_SDK_CHANNEL,
            v: OPENCHAMBER_SDK_API_VERSION,
            type: "resolve-result",
            id: message.id,
            payload
          });
        };
        const handler = resolveHandler;
        if (!handler) {
          answer({ error: "This extension does not resolve commands." });
          return;
        }
        Promise.resolve().then(() => handler(message.payload)).then((item) => answer({ item: item ? clampAttachRequest(item) : null }), (error) => {
          const text = (error instanceof Error ? error.message : String(error)).trim();
          answer({ error: (text || "Command failed.").slice(0, GUEST_RESOLVE_ERROR_MAX) });
        });
        return;
      }
      const waiter = pending.get(message.id);
      if (!waiter)
        return;
      clearTimeout(waiter.timer);
      pending.delete(message.id);
      if (message.ok) {
        waiter.resolve(message.payload);
        return;
      }
      waiter.reject(new HostRequestError(message.code, message.error));
    };
    target.addEventListener("message", onMessage);
    post({
      channel: OPENCHAMBER_SDK_CHANNEL,
      v: OPENCHAMBER_SDK_API_VERSION,
      type: "hello"
    });
    const send = (message, timeoutMs = requestTimeoutMs) => {
      if (disposed || target.parent === target) {
        return Promise.reject(new HostRequestError("HOST_UNAVAILABLE", "No host frame. This page is not in an iframe."));
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(message.id);
          reject(new HostRequestError("HOST_TIMEOUT", "Host did not answer in time."));
        }, timeoutMs);
        pending.set(message.id, { resolve, reject, timer });
        post(message);
      });
    };
    const request = (message) => send(message).then(() => {
      return;
    });
    const envelope = { channel: OPENCHAMBER_SDK_CHANNEL, v: OPENCHAMBER_SDK_API_VERSION };
    const notify = (message) => {
      if (!disposed && target.parent !== target)
        post(message);
    };
    const requestFileSave = () => notify({ ...envelope, type: "file-save" });
    const onSaveShortcut = (event) => {
      if (!isKeyEvent(event) || !isSaveShortcut(event))
        return;
      event.preventDefault();
      requestFileSave();
    };
    const requireIdentity = (value, maximum = 1024) => {
      if (!value.trim() || value.length > maximum)
        throw new HostRequestError("HOST_REJECTED", `Identity must contain 1 to ${maximum} characters.`);
    };
    const readWorkspace = async (query) => {
      if (query.kind !== "projects")
        requireIdentity(query.projectId);
      const result = await send({ ...envelope, type: "workspace-read", id: nextId(ids), payload: query });
      if (!result || !("kind" in result) || !("state" in result) || result.kind !== query.kind) {
        throw new HostRequestError("HOST_REJECTED", "Host did not return workspace data.");
      }
      return result;
    };
    const subscribeWorkspace = async (query, listener) => {
      if (query.kind !== "projects")
        requireIdentity(query.projectId);
      const subscriptionId = nextId(ids);
      workspaceListeners.set(subscriptionId, listener);
      try {
        await request({ ...envelope, type: "workspace-subscribe", id: nextId(ids), payload: { subscriptionId, query } });
      } catch (error) {
        workspaceListeners.delete(subscriptionId);
        if (!disposed)
          post({ ...envelope, type: "workspace-unsubscribe", id: nextId(ids), payload: { subscriptionId } });
        throw error;
      }
      return () => {
        if (!workspaceListeners.delete(subscriptionId) || disposed)
          return;
        post({ ...envelope, type: "workspace-unsubscribe", id: nextId(ids), payload: { subscriptionId } });
      };
    };
    const storage = async (payload) => {
      if ("key" in payload && (payload.key.length === 0 || payload.key.length > GUEST_STORAGE_KEY_MAX)) {
        throw new HostRequestError("HOST_REJECTED", "Storage key must contain 1 to 128 characters.");
      }
      if (payload.op === "set" && !isJsonValue(payload.value)) {
        throw new HostRequestError("HOST_REJECTED", "Storage values must be JSON.");
      }
      if (payload.op === "set" && new TextEncoder().encode(JSON.stringify(payload.value)).length > GUEST_STORAGE_VALUE_BYTES) {
        throw new HostRequestError("HOST_REJECTED", "Storage value exceeds 64 KiB.");
      }
      const result = await send({ ...envelope, type: "storage", id: nextId(ids), payload });
      if (!result || !("storage" in result) || result.op !== payload.op)
        throw new HostRequestError("HOST_REJECTED", "Host did not return storage data.");
      return result;
    };
    return {
      onAction: (handler) => {
        actionHandler = handler;
        return () => {
          if (actionHandler === handler)
            actionHandler = null;
        };
      },
      listProjects: async () => {
        const result = await readWorkspace({ kind: "projects" });
        if (result.kind !== "projects")
          throw new HostRequestError("HOST_REJECTED", "Expected projects.");
        return result;
      },
      listWorktrees: async (projectId) => {
        const result = await readWorkspace({ kind: "worktrees", projectId });
        if (result.kind !== "worktrees")
          throw new HostRequestError("HOST_REJECTED", "Expected worktrees.");
        return result;
      },
      listSessions: async (projectId) => {
        const result = await readWorkspace({ kind: "sessions", projectId });
        if (result.kind !== "sessions")
          throw new HostRequestError("HOST_REJECTED", "Expected sessions.");
        return result;
      },
      onProjects: (listener) => subscribeWorkspace({ kind: "projects" }, (snapshot) => {
        if (snapshot.kind === "projects")
          listener(snapshot);
      }),
      onWorktrees: (projectId, listener) => subscribeWorkspace({ kind: "worktrees", projectId }, (snapshot) => {
        if (snapshot.kind === "worktrees")
          listener(snapshot);
      }),
      onSessions: (projectId, listener) => subscribeWorkspace({ kind: "sessions", projectId }, (snapshot) => {
        if (snapshot.kind === "sessions")
          listener(snapshot);
      }),
      openSession: async (sessionId) => {
        requireIdentity(sessionId);
        await request({ ...envelope, type: "open-session", id: nextId(ids), payload: { sessionId } });
      },
      storage: {
        get: async (key) => {
          const result = await storage({ op: "get", key });
          return result.op === "get" && result.found ? result.value : undefined;
        },
        set: async (key, value) => {
          await storage({ op: "set", key, value });
        },
        delete: async (key) => {
          await storage({ op: "delete", key });
        },
        keys: async () => {
          const result = await storage({ op: "keys" });
          if (result.op !== "keys")
            throw new HostRequestError("HOST_REJECTED", "Expected storage keys.");
          return result.keys;
        }
      },
      onReady: (listener) => {
        readyListeners.add(listener);
        if (lastReady)
          listener(lastReady);
        return () => {
          readyListeners.delete(listener);
        };
      },
      onDirectory: (listener) => {
        directoryListeners.add(listener);
        if (lastReady)
          listener(lastReady.directory);
        return () => {
          directoryListeners.delete(listener);
        };
      },
      onSession: (listener) => {
        sessionListeners.add(listener);
        if (lastReady)
          listener(lastReady.session);
        return () => {
          sessionListeners.delete(listener);
        };
      },
      onSessionLifecycle: (listener) => {
        lifecycleListeners.add(listener);
        if (lastLifecycle)
          listener(lastLifecycle);
        return () => {
          lifecycleListeners.delete(listener);
        };
      },
      onConnection: (listener) => {
        connectionListeners.add(listener);
        if (lastReady)
          listener(lastReady.connection);
        return () => {
          connectionListeners.delete(listener);
        };
      },
      onSettings: (listener) => {
        settingsListeners.add(listener);
        if (lastReady)
          listener(lastReady.settings);
        return () => {
          settingsListeners.delete(listener);
        };
      },
      onItem: (listener) => {
        itemListeners.add(listener);
        if (lastReady)
          listener(lastReady.item);
        return () => {
          itemListeners.delete(listener);
        };
      },
      onResolve: (handler) => {
        resolveHandler = handler;
        return () => {
          if (resolveHandler === handler)
            resolveHandler = null;
        };
      },
      toast: (payload) => {
        const message = payload.message.trim();
        if (!message || message.length > GUEST_TOAST_MAX) {
          return Promise.reject(new HostRequestError("HOST_REJECTED", `Toast message must contain 1 to ${GUEST_TOAST_MAX} characters.`));
        }
        if (payload.copy && payload.copy !== true && (!payload.copy.text.length || payload.copy.text.length > GUEST_CLIPBOARD_TEXT_MAX)) {
          return Promise.reject(new HostRequestError("HOST_REJECTED", `Toast copy text must contain 1 to ${GUEST_CLIPBOARD_TEXT_MAX} characters.`));
        }
        return request({
          channel: OPENCHAMBER_SDK_CHANNEL,
          v: OPENCHAMBER_SDK_API_VERSION,
          type: "toast",
          id: nextId(ids),
          payload: { ...payload, message }
        });
      },
      openUrl: (url) => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "open-url",
        id: nextId(ids),
        payload: { url }
      }),
      openCommit: (sha) => isGuestCommitSha(sha) ? request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "open-commit",
        id: nextId(ids),
        payload: { sha }
      }) : Promise.reject(new HostRequestError("HOST_REJECTED", "Commit id must be 7 to 64 hex characters.")),
      openSurface: (surfaceId) => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "open-surface",
        id: nextId(ids),
        payload: { surfaceId }
      }),
      writeClipboard: (text) => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "clipboard-write",
        id: nextId(ids),
        payload: { text }
      }),
      compose: (payload) => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "compose",
        id: nextId(ids),
        payload
      }),
      attach: (payload) => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "attach",
        id: nextId(ids),
        payload: clampAttachRequest(payload)
      }),
      startSession: async (payload) => {
        if (payload.projectId !== undefined)
          requireIdentity(payload.projectId);
        const worktree = payload.worktree;
        if (worktree && worktree !== true) {
          if (worktree.kind === "existing")
            requireIdentity(worktree.directory);
          else {
            if (worktree.name !== undefined)
              requireIdentity(worktree.name, 200);
            if (worktree.baseBranch !== undefined)
              requireIdentity(worktree.baseBranch, 200);
          }
        }
        const result = await send({
          channel: OPENCHAMBER_SDK_CHANNEL,
          v: OPENCHAMBER_SDK_API_VERSION,
          type: "start-session",
          id: nextId(ids),
          payload: clampStartSessionRequest(payload)
        }, options.requestTimeoutMs ?? 180000);
        if (!isStartSessionResult(result)) {
          throw new HostRequestError("HOST_REJECTED", "Host did not return a session.");
        }
        return result;
      },
      prompt: (payload) => send({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "prompt",
        id: nextId(ids),
        payload: clampPromptRequest(payload)
      }).then((result) => {
        if (!isPromptResult(result)) {
          throw new HostRequestError("HOST_REJECTED", "Host did not return a prompt result.");
        }
        return result;
      }),
      sessionLink: (payload) => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "session-link",
        id: nextId(ids),
        payload: clampAttachRequest(payload)
      }),
      close: () => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "close",
        id: nextId(ids)
      }),
      oauthStart: () => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "oauth-start",
        id: nextId(ids)
      }),
      oauthDisconnect: () => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "oauth-disconnect",
        id: nextId(ids)
      }),
      request: (payload) => (isGuestRequestPath(payload.path) ? send({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "request",
        id: nextId(ids),
        payload
      }) : rejectBadPath()).then((result) => {
        if (!isGuestRequestResult(result)) {
          throw new HostRequestError("HOST_REJECTED", "Host request result was empty.");
        }
        return result;
      }),
      serviceRequest: (payload) => (isGuestRequestPath(payload.path) ? send({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "service-request",
        id: nextId(ids),
        payload
      }) : rejectBadPath()).then((result) => {
        if (!isGuestRequestResult(result)) {
          throw new HostRequestError("HOST_REJECTED", "Host service request result was empty.");
        }
        return result;
      }),
      serviceStatus: () => send({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "service-status",
        id: nextId(ids)
      }).then((result) => {
        if (!isServiceStatusResult(result)) {
          throw new HostRequestError("HOST_REJECTED", "Host did not return service status.");
        }
        return result;
      }),
      readFile: (path) => (isGuestFilePath(path) ? send({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "file-read",
        id: nextId(ids),
        payload: { path }
      }) : rejectBadFilePath()).then((result) => {
        if (!isFileReadResult(result)) {
          throw new HostRequestError("HOST_REJECTED", "Host did not return file content.");
        }
        return result;
      }),
      writeFile: (path, content) => {
        if (!isGuestFilePath(path)) {
          return rejectBadFilePath();
        }
        if (content.length > GUEST_FILE_CONTENT_MAX) {
          return Promise.reject(new HostRequestError("FILE_TOO_LARGE", `Content is over ${GUEST_FILE_CONTENT_MAX} characters.`));
        }
        return send({
          channel: OPENCHAMBER_SDK_CHANNEL,
          v: OPENCHAMBER_SDK_API_VERSION,
          type: "file-write",
          id: nextId(ids),
          payload: { path, content }
        }).then((result) => {
          if (!isFileWriteResult(result)) {
            throw new HostRequestError("HOST_REJECTED", "Host did not confirm the write.");
          }
          return result;
        });
      },
      listDir: (path) => (isGuestFilePath(path) ? send({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "file-list",
        id: nextId(ids),
        payload: { path }
      }) : rejectBadFilePath()).then((result) => {
        if (!isFileListResult(result)) {
          throw new HostRequestError("HOST_REJECTED", "Host did not return directory entries.");
        }
        return result;
      }),
      stat: (path) => (isGuestFilePath(path) ? send({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "file-stat",
        id: nextId(ids),
        payload: { path }
      }) : rejectBadFilePath()).then((result) => {
        if (!isFileStatResult(result)) {
          throw new HostRequestError("HOST_REJECTED", "Host did not return file status.");
        }
        return result;
      }),
      generate: (input) => {
        const prompt = input.prompt.trim();
        const system = input.system?.trim();
        if (prompt.length === 0 || prompt.length > GUEST_GENERATE_PROMPT_MAX) {
          return Promise.reject(new HostRequestError("HOST_REJECTED", `Prompt must be 1 to ${GUEST_GENERATE_PROMPT_MAX} characters.`));
        }
        if (system !== undefined && (system.length === 0 || system.length > GUEST_GENERATE_SYSTEM_MAX)) {
          return Promise.reject(new HostRequestError("HOST_REJECTED", `System prompt must be 1 to ${GUEST_GENERATE_SYSTEM_MAX} characters.`));
        }
        const maxOutputTokens = input.maxOutputTokens === undefined ? undefined : Math.min(GUEST_GENERATE_OUTPUT_TOKENS_MAX, Math.max(1, Math.floor(input.maxOutputTokens)));
        if (maxOutputTokens !== undefined && !Number.isFinite(maxOutputTokens)) {
          return Promise.reject(new HostRequestError("HOST_REJECTED", "maxOutputTokens must be a number."));
        }
        const payload = { prompt };
        if (system !== undefined)
          payload.system = system;
        if (maxOutputTokens !== undefined)
          payload.maxOutputTokens = maxOutputTokens;
        return send({
          channel: OPENCHAMBER_SDK_CHANNEL,
          v: OPENCHAMBER_SDK_API_VERSION,
          type: "generate",
          id: nextId(ids),
          payload
        }, options.requestTimeoutMs ?? GUEST_GENERATE_TIMEOUT_MS).then((result) => {
          if (!isGenerateResult(result)) {
            throw new HostRequestError("HOST_REJECTED", "Host did not return generated text.");
          }
          return result;
        });
      },
      setBadge: (count) => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "badge",
        id: nextId(ids),
        payload: { count: clampBadgeCount(count) }
      }),
      setHeight: (height) => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "resize",
        id: nextId(ids),
        payload: { height: clampFrameHeight(height) }
      }),
      onFileOpen: (listener) => {
        fileOpenListeners.add(listener);
        if (!saveShortcutInstalled) {
          saveShortcutInstalled = true;
          target.addEventListener("keydown", onSaveShortcut, true);
        }
        if (lastFile)
          listener(lastFile);
        return () => {
          fileOpenListeners.delete(listener);
        };
      },
      onFileSnapshot: (handler) => {
        fileSnapshotHandler = handler;
        return () => {
          if (fileSnapshotHandler === handler)
            fileSnapshotHandler = null;
        };
      },
      onFileSaved: (listener) => {
        fileSavedListeners.add(listener);
        return () => {
          fileSavedListeners.delete(listener);
        };
      },
      reportFileChange: (change) => notify({ ...envelope, type: "file-change", payload: { dirty: change.dirty, edited: change.edited } }),
      requestFileSave,
      reportFileUnsupported: () => notify({ ...envelope, type: "file-unsupported" }),
      dispose: () => {
        for (const subscriptionId of workspaceListeners.keys()) {
          post({ ...envelope, type: "workspace-unsubscribe", id: nextId(ids), payload: { subscriptionId } });
        }
        workspaceListeners.clear();
        disposed = true;
        resolveHandler = null;
        actionHandler = null;
        fileSnapshotHandler = null;
        fileOpenListeners.clear();
        fileSavedListeners.clear();
        if (saveShortcutInstalled)
          target.removeEventListener("keydown", onSaveShortcut, true);
        target.removeEventListener("message", onMessage);
        for (const waiter of pending.values()) {
          clearTimeout(waiter.timer);
          waiter.reject(new HostRequestError("HOST_UNAVAILABLE", "Host client was disposed."));
        }
        pending.clear();
        readyListeners.clear();
        directoryListeners.clear();
        sessionListeners.clear();
        lifecycleListeners.clear();
        connectionListeners.clear();
        settingsListeners.clear();
        itemListeners.clear();
      }
    };
  };
  // node_modules/@openchamber/sdk/dist/service-providers.js
  var BROWSER_CONTROL_ACTIONS = [
    "browser.open",
    "browser.snapshot",
    "browser.click",
    "browser.type",
    "browser.scroll",
    "browser.back",
    "browser.forward",
    "browser.inspect",
    "browser.capture",
    "browser.resize"
  ];
  var BROWSER_PROVIDER_IDLE_MS = 10 * 60000;
  var CONTROL_ACTIONS = new Set(BROWSER_CONTROL_ACTIONS);
  // node_modules/@openchamber/sdk/dist/service-surface.js
  var SURFACE_CONTROLLERS = ["none", "agent", "user"];
  var CONTROLLERS = new Set(SURFACE_CONTROLLERS);
  // node_modules/@openchamber/sdk/dist/ui/theme.js
  var TOKEN_VARS = [
    ["--oc-bg", "background"],
    ["--oc-elevated", "elevated"],
    ["--oc-fg", "foreground"],
    ["--oc-muted", "muted"],
    ["--oc-subtle", "subtle"],
    ["--oc-border", "border"],
    ["--oc-hover", "hover"],
    ["--oc-selection", "selection"],
    ["--oc-focus", "focus"],
    ["--oc-primary", "primary"],
    ["--oc-muted-surface", "mutedSurface"],
    ["--oc-elevated-fg", "elevatedForeground"],
    ["--oc-active", "active"],
    ["--oc-selection-fg", "selectionForeground"],
    ["--oc-primary-fg", "primaryForeground"],
    ["--oc-primary-text", "primaryText"],
    ["--oc-success-text", "successText"],
    ["--oc-warning-text", "warningText"],
    ["--oc-error-text", "errorText"],
    ["--oc-info-text", "infoText"],
    ["--oc-success", "success"],
    ["--oc-warning", "warning"],
    ["--oc-error", "error"],
    ["--oc-info", "info"],
    ["--oc-font", "font"],
    ["--oc-mono", "mono"],
    ["--oc-radius", "radius"],
    ["--surface-background", "background"],
    ["--surface-elevated", "elevated"],
    ["--surface-foreground", "foreground"],
    ["--surface-muted-foreground", "muted"],
    ["--surface-subtle", "subtle"],
    ["--interactive-border", "border"],
    ["--interactive-hover", "hover"],
    ["--interactive-selection", "selection"],
    ["--interactive-focus-ring", "focus"],
    ["--primary", "primary"],
    ["--surface-muted", "mutedSurface"],
    ["--surface-elevated-foreground", "elevatedForeground"],
    ["--interactive-active", "active"],
    ["--interactive-selection-foreground", "selectionForeground"],
    ["--primary-foreground", "primaryForeground"],
    ["--primary-text", "primaryText"],
    ["--success-text", "successText"],
    ["--warning-text", "warningText"],
    ["--error-text", "errorText"],
    ["--info-text", "infoText"],
    ["--status-success", "success"],
    ["--status-warning", "warning"],
    ["--status-error", "error"],
    ["--status-info", "info"],
    ["--font-sans", "font"],
    ["--font-mono", "mono"],
    ["--radius", "radius"]
  ];
  var applyHostTheme = (theme, root) => {
    root.style.colorScheme = theme.mode;
    for (const [name, key] of TOKEN_VARS) {
      root.style.setProperty(name, theme.tokens[key]);
    }
    root.style.setProperty("font-family", theme.tokens.font);
    root.style.setProperty("font-size", "0.875rem");
    root.style.setProperty("line-height", "1.45");
    root.style.setProperty("color", theme.tokens.foreground);
  };
  var applyHostReady = (ctx, root) => {
    applyHostTheme(ctx.theme, root);
    if (root.dataset) {
      root.dataset.ocSurface = ctx.surface;
      root.dataset.ocTheme = ctx.theme.mode;
    }
  };
  // node_modules/@openchamber/sdk/dist/ui/style.js
  var OC_ALIAS = {
    "surface-background": "bg",
    "surface-elevated": "elevated",
    "surface-elevated-foreground": "elevated-fg",
    "surface-foreground": "fg",
    "surface-muted-foreground": "muted",
    "surface-muted": "muted-surface",
    "surface-subtle": "subtle",
    "interactive-border": "border",
    "interactive-hover": "hover",
    "interactive-active": "active",
    "interactive-selection": "selection",
    "interactive-selection-foreground": "selection-fg",
    "interactive-focus-ring": "focus",
    primary: "primary",
    "primary-foreground": "primary-fg",
    "primary-text": "primary-text",
    "success-text": "success-text",
    "warning-text": "warning-text",
    "error-text": "error-text",
    "info-text": "info-text",
    "status-success": "success",
    "status-warning": "warning",
    "status-error": "error",
    "status-info": "info",
    "font-sans": "font",
    "font-mono": "mono",
    radius: "radius"
  };
  var v = (name, fallback) => `var(--${name}, var(--oc-${OC_ALIAS[name]}, ${fallback}))`;
  var bg = v("surface-background", "transparent");
  var elevated = v("surface-elevated", "transparent");
  var elevatedFg = v("surface-elevated-foreground", "inherit");
  var fg = v("surface-foreground", "inherit");
  var muted = v("surface-muted-foreground", "gray");
  var secondary = v("surface-muted", "transparent");
  var border = v("interactive-border", "currentColor");
  var hover = v("interactive-hover", "transparent");
  var active = v("interactive-active", "transparent");
  var selection = v("interactive-selection", "transparent");
  var selectionFg = v("interactive-selection-foreground", "inherit");
  var focus = v("interactive-focus-ring", "currentColor");
  var primary = v("primary", "currentColor");
  var primaryText = v("primary-text", "inherit");
  var errorText = v("error-text", "inherit");
  var font = v("font-sans", "inherit");
  var mono = v("font-mono", "monospace");
  var radius = v("radius", "9px");
  var mix = (color, pct, base = "transparent") => `color-mix(in srgb, ${color} ${pct}%, ${base})`;
  var focusRing = `box-shadow: 0 0 0 2px ${focus};`;
  var tone = (name) => {
    const color = v(`status-${name}`, "currentColor");
    return `
.oc-sdk[data-tone="${name}"], .oc-sdk [data-tone="${name}"] { --oc-sdk-tone: ${color}; --oc-sdk-tone-text: ${v(`${name}-text`, "inherit")}; }`;
  };
  var UI_CSS = `
${GUEST_SCROLLBAR_CSS}
.oc-sdk { box-sizing: border-box; color: ${fg}; font-family: ${font}; font-size: 0.875rem; line-height: 1.45; }
.oc-sdk *, .oc-sdk *::before, .oc-sdk *::after { box-sizing: border-box; }
/* :where() keeps the reset at zero specificity so every primitive class below overrides it. */
:where(.oc-sdk) :where(button, input, textarea), :where(button.oc-sdk, input.oc-sdk, textarea.oc-sdk) { font: inherit; color: inherit; margin: 0; }
:where(.oc-sdk) :where(button), :where(button.oc-sdk) { cursor: pointer; background: none; border: 0; padding: 0; }
.oc-sdk button:disabled, button.oc-sdk:disabled, .oc-sdk[aria-disabled="true"], .oc-sdk [aria-disabled="true"] { opacity: .5; pointer-events: none; }
.oc-sdk :focus-visible { outline: none; ${focusRing} }
.oc-sdk-mono { font-family: ${mono}; }
.oc-sdk-muted { color: ${muted}; }
${tone("success")}${tone("warning")}${tone("error")}${tone("info")}
.oc-sdk[data-tone="primary"], .oc-sdk [data-tone="primary"] { --oc-sdk-tone: ${primary}; --oc-sdk-tone-text: ${primaryText}; }

.oc-sdk-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 36px; padding: 0 14px; border: 1px solid transparent; border-radius: ${radius}; font-size: 0.875rem; font-weight: 500; line-height: 1; white-space: nowrap; transition: background 150ms ease-out, color 150ms ease-out; }
.oc-sdk-btn[data-size="sm"] { height: 32px; padding: 0 10px; font-size: 0.8125rem; }
.oc-sdk-btn[data-size="xs"] { height: 24px; padding: 0 8px; font-size: 0.75rem; border-radius: 6px; }
.oc-sdk-btn[data-variant="default"] { color: ${primaryText}; background: ${mix(primary, 10, bg)}; border-color: ${mix(primary, 12)}; }
.oc-sdk-btn[data-variant="default"]:hover { background: ${mix(primary, 16, bg)}; }
.oc-sdk-btn[data-variant="default"]:active { background: ${mix(primary, 22, bg)}; }
.oc-sdk-btn[data-variant="secondary"] { background: ${secondary}; color: var(--oc-fg); }
.oc-sdk-btn[data-variant="secondary"]:hover { background-image: linear-gradient(${hover}, ${hover}); }
.oc-sdk-btn[data-variant="secondary"]:active { background-image: linear-gradient(${active}, ${active}); }
.oc-sdk-btn[data-variant="outline"] { background: ${elevated}; color: ${elevatedFg}; border-color: ${border}; }
.oc-sdk-btn[data-variant="outline"]:hover { background-image: linear-gradient(${hover}, ${hover}); }
.oc-sdk-btn[data-variant="outline"]:active { background-image: linear-gradient(${active}, ${active}); }
.oc-sdk-btn[data-variant="ghost"] { background: transparent; }
.oc-sdk-btn[data-variant="ghost"]:hover { background: ${hover}; }
.oc-sdk-btn[data-variant="ghost"]:active { background: ${active}; }
.oc-sdk-btn[data-variant="destructive"] { --oc-sdk-tone: ${v("status-error", "red")}; color: ${errorText}; background: ${mix("var(--oc-sdk-tone)", 7, bg)}; border-color: ${mix("var(--oc-sdk-tone)", 12)}; }
.oc-sdk-btn[data-variant="destructive"]:hover { background: ${mix("var(--oc-sdk-tone)", 9, bg)}; }
.oc-sdk-btn[data-variant="destructive"]:active { background: ${mix("var(--oc-sdk-tone)", 11, bg)}; }
.oc-sdk-btn[data-loading="true"] { opacity: .5; pointer-events: none; }
.oc-sdk-btn > .oc-sdk-spinner-ring { width: 14px; height: 14px; }

.oc-sdk-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.oc-sdk-field-label { font-size: 0.8125rem; font-weight: 500; }
.oc-sdk-field-note { font-size: 0.75rem; color: ${muted}; }
.oc-sdk-field[data-invalid="true"] .oc-sdk-field-note { color: ${errorText}; }
.oc-sdk-input { display: block; width: 100%; min-width: 0; height: 36px; padding: 0 12px; border: 0; border-radius: ${radius}; background: ${elevated}; color: ${elevatedFg}; font-size: 0.875rem; line-height: 1.45; appearance: none; box-shadow: inset 0 0 0 1px ${mix(border, 60)}; transition: background 150ms ease-out, box-shadow 150ms ease-out; }
textarea.oc-sdk-input { height: auto; padding: 8px 12px; resize: vertical; }
.oc-sdk-input::placeholder { color: ${muted}; }
.oc-sdk-input:hover:not(:focus) { background-image: linear-gradient(${hover}, ${hover}); }
.oc-sdk-input:focus, .oc-sdk-input:focus-visible { box-shadow: inset 0 0 0 2px ${focus}; }
.oc-sdk-field[data-invalid="true"] .oc-sdk-input { box-shadow: inset 0 0 0 1px ${v("status-error", "red")}; }
.oc-sdk-field[data-invalid="true"] .oc-sdk-input:focus { box-shadow: inset 0 0 0 2px ${v("status-error", "red")}; }
.oc-sdk-input[data-mono="true"] { font-family: ${mono}; }

.oc-sdk-search { position: relative; min-width: 0; }
.oc-sdk-search .oc-sdk-input { padding-left: 34px; padding-right: 34px; }
.oc-sdk-search-icon { position: absolute; left: 11px; top: 50%; transform: translateY(-50%); color: ${muted}; pointer-events: none; }
.oc-sdk-search[data-active="true"] .oc-sdk-search-icon { color: ${primary}; }
.oc-sdk-search-clear { position: absolute; right: 6px; top: 50%; transform: translateY(-50%); display: none; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 6px; color: ${muted}; }
.oc-sdk-search[data-active="true"] .oc-sdk-search-clear { display: inline-flex; }
.oc-sdk-search-clear:hover { background: ${hover}; color: ${fg}; }

.oc-sdk-select { position: relative; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.oc-sdk-trigger { display: inline-flex; align-items: center; gap: 6px; width: 100%; min-width: 0; height: 32px; padding: 0 8px 0 10px; border: 1px solid ${border}; border-radius: 6px; background: ${elevated}; color: ${elevatedFg}; font-size: 0.8125rem; text-align: left; transition: background 150ms ease-out; }
.oc-sdk-trigger:hover { background-image: linear-gradient(${hover}, ${hover}); }
.oc-sdk-trigger[aria-expanded="true"] { background-image: linear-gradient(${active}, ${active}); }
.oc-sdk-trigger-value { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oc-sdk-trigger-value[data-empty="true"] { color: ${muted}; }
.oc-sdk-trigger-chevron { flex: 0 0 auto; color: ${muted}; }
.oc-sdk-popup { --surface-foreground: ${elevatedFg}; position: fixed; z-index: 50; display: flex; flex-direction: column; gap: 2px; min-width: 160px; max-width: calc(100vw - 16px); max-height: min(320px, calc(100vh - 16px)); overflow: auto; padding: 4px; border: 1px solid ${mix(border, 60)}; border-radius: 12px; background: ${elevated}; color: ${elevatedFg}; box-shadow: 0 8px 24px ${mix(fg, 12)}; }
.oc-sdk-popup-search { flex: 0 0 auto; padding: 2px 2px 4px; }
.oc-sdk-popup-search .oc-sdk-input { height: 32px; font-size: 0.8125rem; }
.oc-sdk-option { display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 8px; border-radius: 8px; font-size: 0.8125rem; text-align: left; }
.oc-sdk-option[data-active="true"] { background: ${hover}; }
.oc-sdk-option[aria-selected="true"] { background: ${selection}; color: ${selectionFg}; }
.oc-sdk-option[data-destructive="true"] { color: ${errorText}; }
.oc-sdk-option[data-destructive="true"][data-active="true"] { background: ${mix(v("status-error", "red"), 10)}; }
.oc-sdk-option-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oc-sdk-option-hint { flex: 0 0 auto; font-size: 0.75rem; color: ${muted}; }
.oc-sdk-option-check { flex: 0 0 auto; width: 12px; }
.oc-sdk-popup-empty { padding: 8px; font-size: 0.8125rem; color: ${muted}; }

.oc-sdk-check { display: inline-flex; align-items: flex-start; gap: 8px; width: 100%; text-align: left; }
.oc-sdk-check-box { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; width: 14px; height: 14px; margin-top: 3px; border: 1px solid ${border}; border-radius: 4px; color: ${primary}; transition: border-color 150ms ease-out; }
.oc-sdk-check[aria-checked="true"] .oc-sdk-check-box { border-color: ${mix(primary, 65, border)}; }
.oc-sdk-check-box > svg { display: none; }
.oc-sdk-check[aria-checked="true"] .oc-sdk-check-box > svg { display: block; }
.oc-sdk-check-thumb { flex: 0 0 auto; position: relative; width: 36px; height: 20px; border-radius: 9999px; background: ${border}; transition: background 150ms ease-out; }
.oc-sdk-check-thumb::after { content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 9999px; background: ${bg}; transition: transform 150ms ease-out; }
.oc-sdk-check[aria-checked="true"] .oc-sdk-check-thumb { background: ${primary}; }
.oc-sdk-check[aria-checked="true"] .oc-sdk-check-thumb::after { transform: translateX(16px); }
.oc-sdk-check:focus-visible { box-shadow: none; }
.oc-sdk-check:focus-visible .oc-sdk-check-box, .oc-sdk-check:focus-visible .oc-sdk-check-thumb { ${focusRing} }
.oc-sdk-check-text { display: flex; flex-direction: column; min-width: 0; }
.oc-sdk-check-label { font-size: 0.875rem; }
.oc-sdk-check-desc { font-size: 0.75rem; color: ${muted}; }

.oc-sdk-tabs { display: inline-flex; gap: 2px; padding: 2px; border-radius: 10px; max-width: 100%; overflow: auto; }
.oc-sdk-tabs[data-track="true"] { background: ${mix(fg, 4)}; }
.oc-sdk-tab { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px; border: 1px solid transparent; border-radius: 8px; font-size: 0.8125rem; font-weight: 500; color: ${muted}; white-space: nowrap; transition: color 150ms ease-out, background 150ms ease-out; }
.oc-sdk-tab:hover { color: ${fg}; }
.oc-sdk-tab[aria-selected="true"] { color: ${selectionFg}; background: ${selection}; border-color: ${border}; }
.oc-sdk-tab-count { font-size: 0.75rem; font-variant-numeric: tabular-nums; color: ${muted}; }

.oc-sdk-badge { display: inline-flex; align-items: center; padding: 1px 6px; border-radius: 9999px; font-size: 11px; font-weight: 500; line-height: 16px; white-space: nowrap; background: ${hover}; color: ${muted}; }
.oc-sdk-badge[data-tone] { color: var(--oc-sdk-tone-text, var(--oc-sdk-tone)); background: ${mix("var(--oc-sdk-tone)", 15)}; }

.oc-sdk-list { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.oc-sdk-row { display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 8px; border-radius: 6px; text-align: left; transition: background 120ms ease-out; }
.oc-sdk-row:hover, .oc-sdk-row[data-active="true"] { background: ${hover}; }
.oc-sdk-row[aria-selected="true"] { background: ${selection}; color: ${selectionFg}; }
.oc-sdk-row-lead { flex: 0 0 auto; width: 64px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: ${mono}; font-size: 0.75rem; color: ${muted}; }
.oc-sdk-row-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; }
.oc-sdk-row-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oc-sdk-row-sub { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.75rem; color: ${muted}; }
.oc-sdk-row-meta { flex: 0 0 auto; font-size: 0.75rem; font-variant-numeric: tabular-nums; color: ${muted}; }
.oc-sdk-row[aria-selected="true"] .oc-sdk-row-lead, .oc-sdk-row[aria-selected="true"] .oc-sdk-row-sub, .oc-sdk-row[aria-selected="true"] .oc-sdk-row-meta { color: inherit; opacity: .75; }
.oc-sdk-list-empty { padding: 16px 8px; text-align: center; font-size: 0.8125rem; color: ${muted}; }

.oc-sdk-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; padding: 40px 16px; text-align: center; }
.oc-sdk-empty-title { margin: 0; font-size: 0.8125rem; font-weight: 600; }
.oc-sdk-empty-body { margin: 0; max-width: 32rem; font-size: 0.8125rem; color: ${muted}; }
.oc-sdk-empty-action { margin-top: 12px; }

@keyframes oc-sdk-spin { to { transform: rotate(360deg); } }
.oc-sdk-spinner { display: inline-flex; align-items: center; gap: 8px; font-size: 0.8125rem; color: ${muted}; }
.oc-sdk-spinner-ring { width: 16px; height: 16px; border: 2px solid ${border}; border-top-color: ${primary}; border-radius: 9999px; animation: oc-sdk-spin .8s linear infinite; }
.oc-sdk-spinner[data-size="sm"] .oc-sdk-spinner-ring { width: 12px; height: 12px; }

.oc-sdk-banner { display: flex; align-items: flex-start; gap: 12px; padding: 8px 12px; border: 1px solid ${mix("var(--oc-sdk-tone)", 40)}; border-radius: 8px; background: ${mix("var(--oc-sdk-tone)", 10)}; }
.oc-sdk-banner-text { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.oc-sdk-banner-title { font-size: 0.8125rem; font-weight: 500; color: var(--oc-sdk-tone-text, var(--oc-sdk-tone)); }
.oc-sdk-banner-body { font-size: 0.8125rem; color: ${muted}; }
.oc-sdk-banner-action { flex: 0 0 auto; }

.oc-sdk-separator { display: flex; align-items: center; gap: 8px; width: 100%; margin: 8px 0; font-size: 0.75rem; color: ${muted}; }
.oc-sdk-separator::before, .oc-sdk-separator::after { content: ""; flex: 1 1 auto; height: 1px; background: ${mix(border, 40)}; }
.oc-sdk-separator[data-labeled="false"]::after { display: none; }
.oc-sdk-popup > .oc-sdk-separator { margin: 4px 0; }

.oc-sdk-progress { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.oc-sdk-progress-label { display: flex; justify-content: space-between; font-size: 0.75rem; color: ${muted}; font-variant-numeric: tabular-nums; }
.oc-sdk-progress-track { height: 6px; border-radius: 9999px; background: ${border}; overflow: hidden; }
.oc-sdk-progress-fill { height: 100%; border-radius: 9999px; background: var(--oc-sdk-tone, ${primary}); transform-origin: left; transition: transform 200ms ease-out; }

.oc-sdk-menu { position: relative; display: inline-flex; }

.oc-sdk-text { white-space: pre-wrap; overflow-wrap: anywhere; }
.oc-sdk-text a { color: ${primaryText}; text-decoration: underline; text-underline-offset: 2px; }
.oc-sdk-text img { display: block; max-width: 100%; margin: 8px 0; border-radius: 8px; border: 1px solid ${mix(border, 60)}; }
`;
  // src/viewport.js
  var MIN_H = 24;
  var MAX_H = 320;
  var clamp = (value, lo, hi) => {
    const n = Number.isFinite(value) ? Math.round(value) : lo;
    return Math.min(hi, Math.max(lo, n));
  };
  var clampScroll = (value, max) => {
    const top = Math.max(0, Number.isFinite(max) ? Math.floor(max) : 0);
    const n = Number.isFinite(value) ? Math.round(value) : 0;
    return Math.min(top, Math.max(0, n));
  };
  function nearestIndex(offset, starts) {
    if (!Array.isArray(starts) || starts.length === 0)
      return 0;
    const value = Number.isFinite(offset) ? offset : 0;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0;i < starts.length; i += 1) {
      const dist = Math.abs(starts[i] - value);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    return best;
  }

  // src/doc.js
  var STATUSES = new Set(["pending", "in_progress", "completed", "cancelled"]);
  var isFinished = (todo) => todo.status === "completed" || todo.status === "cancelled";
  function normalizeDoc(data) {
    const raw = data && Array.isArray(data.todos) ? data.todos : [];
    const todos = [];
    for (const entry of raw) {
      if (entry === null || typeof entry !== "object")
        continue;
      const text = typeof entry.content === "string" ? entry.content.trim() : "";
      if (!text)
        continue;
      if (!STATUSES.has(entry.status))
        continue;
      const todo = {
        content: text,
        status: entry.status,
        priority: typeof entry.priority === "string" ? entry.priority : ""
      };
      if (typeof entry.id === "string" && entry.id !== "")
        todo.id = entry.id;
      if (typeof entry.parentId === "string" && entry.parentId !== "")
        todo.parentId = entry.parentId;
      if (typeof entry.phase === "string" && entry.phase !== "")
        todo.phase = entry.phase;
      if (Array.isArray(entry.dependsOn)) {
        todo.dependsOn = entry.dependsOn.filter((dep) => typeof dep === "string" && dep !== "");
      }
      todos.push(todo);
    }
    const phases = data && Array.isArray(data.phases) ? data.phases.filter((phase) => typeof phase === "string" && phase !== "") : [];
    return { todos, phases };
  }
  function parseDoc(content) {
    let data;
    try {
      data = JSON.parse(content);
    } catch {
      return null;
    }
    return normalizeDoc(data);
  }

  // src/graph.js
  var INDENT = 9;
  var MAX_DEPTH = 6;
  var PHASE_TOKENS = [
    "var(--oc-syntax-keyword, var(--oc-primary))",
    "var(--oc-syntax-string, var(--oc-info))",
    "var(--oc-syntax-number, var(--oc-success))",
    "var(--oc-syntax-function, var(--oc-warning))",
    "var(--oc-syntax-type, var(--oc-error))"
  ];
  var phaseColor = (index) => {
    const n = Number.isFinite(index) ? Math.trunc(index) : 0;
    const len = PHASE_TOKENS.length;
    return PHASE_TOKENS[(n % len + len) % len];
  };
  var phaseColorIndex = (phase, list) => {
    const i = Array.isArray(list) ? list.indexOf(phase) : -1;
    return i < 0 ? 0 : i;
  };
  function phaseList(declared, todos) {
    const out = [];
    const seen = new Set;
    const add = (p) => {
      if (typeof p === "string" && p !== "" && !seen.has(p)) {
        seen.add(p);
        out.push(p);
      }
    };
    if (Array.isArray(declared))
      for (const p of declared)
        add(p);
    for (const todo of todos)
      add(todo && todo.phase);
    return out;
  }
  function hasStructure(todos) {
    return todos.some((t) => {
      if (!t)
        return false;
      if (t.parentId !== undefined && t.parentId !== null)
        return true;
      return typeof t.phase === "string" && t.phase !== "";
    });
  }
  function buildTree(todos, declared = []) {
    const list = Array.isArray(todos) ? todos : [];
    const phases = phaseList(declared, list);
    const taken = new Set;
    const nodes = list.map((todo, index) => {
      const id = typeof todo.id === "string" ? todo.id : "";
      let key = `#${index}`;
      if (id !== "") {
        key = taken.has(id) ? `${id}#${index}` : id;
        taken.add(id);
      }
      return {
        key,
        index,
        content: todo.content,
        status: todo.status,
        priority: todo.priority || "",
        phase: typeof todo.phase === "string" ? todo.phase : "",
        colorIndex: phaseColorIndex(todo.phase, phases),
        dependsOn: Array.isArray(todo.dependsOn) ? todo.dependsOn : [],
        synthetic: todo.synthetic === true,
        parent: null,
        children: []
      };
    });
    const byId = new Map;
    for (const node of nodes) {
      const id = list[node.index].id;
      if (typeof id === "string" && id !== "" && !byId.has(id))
        byId.set(id, node);
    }
    for (const node of nodes) {
      const pid = list[node.index].parentId;
      if (typeof pid !== "string" || pid === "")
        continue;
      const parent = byId.get(pid);
      if (parent && parent !== node)
        node.parent = parent;
    }
    const nested = list.some((todo) => typeof todo.parentId === "string" && todo.parentId !== "");
    if (!nested && phases.length > 0) {
      const used = new Set(list.map((todo) => typeof todo.phase === "string" && todo.phase !== "" ? todo.phase : ""));
      const groups = new Map;
      for (const phase of phases) {
        if (!used.has(phase))
          continue;
        const group = {
          key: `phase:${phase}`,
          index: -1,
          content: phase,
          status: "",
          priority: "",
          phase,
          colorIndex: phaseColorIndex(phase, phases),
          dependsOn: [],
          synthetic: true,
          parent: null,
          children: []
        };
        groups.set(phase, group);
        nodes.push(group);
      }
      for (const node of nodes) {
        if (node.synthetic || node.parent)
          continue;
        const phase = list[node.index].phase;
        if (typeof phase === "string" && phase !== "" && groups.has(phase))
          node.parent = groups.get(phase);
      }
    }
    const state = new Map;
    for (const start of nodes) {
      if (state.get(start) === 2)
        continue;
      const path = [];
      let cur = start;
      while (cur && state.get(cur) !== 2 && state.get(cur) !== 1) {
        state.set(cur, 1);
        path.push(cur);
        cur = cur.parent;
      }
      if (cur && state.get(cur) === 1) {
        const from = path.indexOf(cur);
        for (let i = from;i < path.length; i += 1)
          path[i].parent = null;
      }
      for (const node of path)
        state.set(node, 2);
    }
    const roots = [];
    for (const node of nodes) {
      if (node.parent)
        node.parent.children.push(node);
      else
        roots.push(node);
    }
    const rows = [];
    const visit = (node, depth, isLast, ancestorLast) => {
      rows.push({
        key: node.key,
        index: node.index,
        content: node.content,
        status: node.status,
        priority: node.priority,
        phase: node.phase,
        colorIndex: node.colorIndex,
        depth: Math.min(depth, MAX_DEPTH),
        isLast,
        ancestorLast,
        synthetic: node.synthetic === true,
        blocked: node.dependsOn.some((dep) => {
          const target = byId.get(dep);
          return Boolean(target) && target.status !== "completed";
        })
      });
      const kids = node.children;
      for (let i = 0;i < kids.length; i += 1) {
        visit(kids[i], depth + 1, i === kids.length - 1, ancestorLast.concat([isLast]));
      }
    };
    for (const root of roots)
      visit(root, 0, root === roots[roots.length - 1], []);
    return { rows, hasStructure: hasStructure(list), phases };
  }
  function pruneFinished(todos) {
    const list = Array.isArray(todos) ? todos : [];
    const indexById = new Map;
    for (let i = 0;i < list.length; i += 1) {
      const id = list[i].id;
      if (typeof id === "string" && id !== "" && !indexById.has(id))
        indexById.set(id, i);
    }
    const keep = new Set;
    for (let i = 0;i < list.length; i += 1)
      if (!isFinished(list[i]))
        keep.add(i);
    const addAncestors = (index) => {
      let parentId = list[index].parentId;
      while (typeof parentId === "string" && parentId !== "" && indexById.has(parentId)) {
        const parent = indexById.get(parentId);
        if (keep.has(parent))
          break;
        keep.add(parent);
        parentId = list[parent].parentId;
      }
    };
    for (const index of [...keep])
      addAncestors(index);
    return list.filter((_, index) => keep.has(index));
  }

  // src/gutter.js
  var GUT_NODE = 11;
  var NODE_Y = 11;
  var GUT_CSS = `
.gut { flex: 0 0 auto; align-self: stretch; position: relative; min-height: 18px; }
.gut-svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.gut-svg line { stroke: var(--oc-muted, #6f6e69); stroke-width: 1.4; opacity: .5; }
.gut-halo { transform-box: fill-box; transform-origin: center; animation: todo-gut-halo 2200ms ease-in-out infinite; }
@keyframes todo-gut-halo {
  0%, 100% { transform: scale(1); opacity: .85; }
  50% { transform: scale(1.55); opacity: .28; }
}
@media (prefers-reduced-motion: reduce) { .gut-halo { animation: none; } }
`;
  function ensureGutStyle(doc) {
    if (doc.getElementById("gut-style"))
      return;
    const style = doc.createElement("style");
    style.id = "gut-style";
    style.textContent = GUT_CSS;
    doc.head.append(style);
  }
  function symbolSvg(status, x, y, color) {
    const r = 4;
    if (status === "completed") {
      return `<circle cx="${x}" cy="${y}" r="${r}" fill="${color}"/>` + `<path class="gut-tick" d="M${x - 2.1} ${y + 0.1} L${x - 0.5} ${y + 1.7} L${x + 2.3} ${y - 1.7}"` + ` fill="none" stroke="var(--oc-bg, #fff)" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>`;
    }
    if (status === "cancelled") {
      return `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${color}" stroke-width="1.6" stroke-dasharray="2 2" opacity=".7"/>` + `<line x1="${x - 2.2}" y1="${y - 2.2}" x2="${x + 2.2}" y2="${y + 2.2}" stroke="${color}" stroke-width="1.4" opacity=".7"/>`;
    }
    if (status === "in_progress") {
      return `<circle class="gut-halo" cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${color}" stroke-width="1.6"/>` + `<circle cx="${x}" cy="${y}" r="${r - 1.4}" fill="${color}"/>`;
    }
    return `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${color}" stroke-width="1.6"/>`;
  }
  function gutterSvg(tree, status) {
    const d = tree.depth;
    const cx = (lane) => lane * INDENT + GUT_NODE / 2;
    const color = phaseColor(tree.colorIndex);
    const last = tree.isLast;
    let body = "";
    for (let lane = 0;lane < d; lane += 1) {
      const x = cx(lane);
      if (lane === d - 1) {
        body += `<line x1="${x}" y1="0" x2="${x}" y2="${last ? NODE_Y : "100%"}" stroke="${color}" opacity=".8"/>`;
        body += `<line x1="${x}" y1="${NODE_Y}" x2="${cx(d)}" y2="${NODE_Y}" stroke="${color}" opacity=".8"/>`;
      } else if (tree.ancestorLast[lane + 1] === false) {
        body += `<line x1="${x}" y1="0" x2="${x}" y2="100%"/>`;
      }
    }
    if (tree.synthetic) {
      body += `<rect x="${cx(d) - 3.5}" y="${NODE_Y - 3.5}" width="7" height="7" rx="2" fill="${color}"/>`;
    } else {
      body += symbolSvg(status, cx(d), NODE_Y, color);
      if (tree.blocked) {
        body += `<circle cx="${cx(d)}" cy="${NODE_Y}" r="6.6" fill="none" stroke="var(--oc-error, #af3029)"` + ` stroke-width="1.3" stroke-dasharray="2 2"><title>受阻：依赖未完成</title></circle>`;
      }
    }
    return `<svg class="gut-svg" aria-hidden="true">${body}</svg>`;
  }

  // src/plugin-install.js
  var PLUGIN_ID = "openchamber-todo-bridge";
  var PLUGIN_DIR_PATH = `~/.config/opencode/plugins/${PLUGIN_ID}`;
  var PLUGIN_ENTRY_PATH = `${PLUGIN_DIR_PATH}/index.js`;
  var PLUGIN_MANIFEST_PATH = `${PLUGIN_DIR_PATH}/package.json`;
  var SOURCE = `/**
 * openchamber-todo-bridge — OpenCode plugin.
 *
 * OpenCode v2 removed the \`todowrite\` / \`todoread\` tools (intentionally: the
 * maintainers found them to slow the agent down). Nothing replaced them for
 * tools that want to *read* the list, so an external UI has no supported way to
 * show progress.
 *
 * This plugin does two things, and owns both halves:
 *
 *   1. Registers \`todowrite\` / \`todoread\` again, with V1-compatible fields, and
 *      keeps the list in OpenCode's plugin storage. The current list is injected
 *      as system context on every model request while tasks are open, so the
 *      model keeps track of it across long conversations and compaction.
 *
 *   2. Mirrors the list to a plain per-session JSON file, which the companion
 *      OpenChamber extension reads into the Work Status panel. This is the only
 *      shared channel available: OpenCode v2 has no todo HTTP endpoint, no todo
 *      event, and no plugin API for the native todo table, so a file is the one
 *      medium both sides can reach.
 *
 * It deliberately does not depend on any other plugin.
 *
 * Data file:
 *   <TODO_BRIDGE_DIR>/<sessionID>.json     (default ~/.config/openchamber/todos)
 *   { version: 2, sessionID, phases?, todos: [{ content, status, priority?, id?,
 *     parentId?, phase?, dependsOn? }], updatedAt }
 *   A v1 file (no \`version\`, flat items) is still read; the extra fields are
 *   optional and only drive the visual task tree.
 *
 *   <TODO_BRIDGE_DIR>/_index.json          the sessions the board reads, newest
 *   first, each with a summary (title, counts, phases) so the board can render
 *   its summary bar and headers without opening every mirror.
 */

import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

const TODO_STATUSES = ["pending", "in_progress", "completed", "cancelled"]
const TODO_PRIORITIES = ["high", "medium", "low"]
const STORAGE_PREFIX = "todos/"
/** The session index the board reads (the board may not \`listDir\` the folder). */
const INDEX_NAME = "_index.json"
const MARK = { pending: "[ ]", in_progress: "[•]", completed: "[x]", cancelled: "[-]" }

/** Where the mirror writes. Override for testing with TODO_BRIDGE_DIR. */
function mirrorDir() {
  const override = process.env.TODO_BRIDGE_DIR
  if (typeof override === "string" && override.trim() !== "") return override.trim()
  return join(homedir(), ".config", "openchamber", "todos")
}

const storageKey = (sessionID) => \`\${STORAGE_PREFIX}\${sessionID}\`

/** A non-empty trimmed string, or a readable error for the model to correct. */
function requireString(value, what) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(\`\${what} must be a non-empty string\`)
  }
  return value.trim()
}

/**
 * Validates a \`todowrite\` payload. Throws with a readable message so the model
 * can correct itself instead of silently losing the list.
 *
 * The structure fields (\`id\`, \`parentId\`, \`phase\`, \`dependsOn\`, top-level
 * \`phases\`) are optional and drive the visual task tree; a present one is still
 * validated, so a typo is caught rather than drawn as a broken tree.
 */
export function normalize(input) {
  if (input === null || typeof input !== "object" || !("todos" in input)) {
    throw new Error("todowrite requires a \`todos\` array")
  }
  const raw = input.todos
  if (!Array.isArray(raw)) throw new Error("\`todos\` must be an array")

  const todos = raw.map((entry, index) => {
    const at = \`todo #\${index + 1}\`
    if (entry === null || typeof entry !== "object") {
      throw new Error(\`\${at} must be an object\`)
    }
    const content = typeof entry.content === "string" ? entry.content.trim() : ""
    if (!content) throw new Error(\`\${at} requires a non-empty \\\`content\\\` string\`)
    if (!TODO_STATUSES.includes(entry.status)) {
      throw new Error(\`\${at} has invalid \\\`status\\\` (expected: \${TODO_STATUSES.join(", ")})\`)
    }
    const todo = { content, status: entry.status }
    if (entry.priority !== undefined) {
      if (!TODO_PRIORITIES.includes(entry.priority)) {
        throw new Error(\`\${at} has invalid \\\`priority\\\` (expected: \${TODO_PRIORITIES.join(", ")})\`)
      }
      todo.priority = entry.priority
    }
    if (entry.id !== undefined) todo.id = requireString(entry.id, \`\${at} \\\`id\\\`\`)
    if (entry.parentId !== undefined && entry.parentId !== null) {
      todo.parentId = requireString(entry.parentId, \`\${at} \\\`parentId\\\`\`)
    }
    if (entry.phase !== undefined) todo.phase = requireString(entry.phase, \`\${at} \\\`phase\\\`\`)
    if (entry.dependsOn !== undefined) {
      if (!Array.isArray(entry.dependsOn) || entry.dependsOn.some((dep) => typeof dep !== "string" || dep.trim() === "")) {
        throw new Error(\`\${at} \\\`dependsOn\\\` must be an array of non-empty strings\`)
      }
      todo.dependsOn = entry.dependsOn.map((dep) => dep.trim())
    }
    return todo
  })

  const result = { todos }
  if (input.phases !== undefined) {
    if (!Array.isArray(input.phases) || input.phases.some((p) => typeof p !== "string" || p.trim() === "")) {
      throw new Error("\`phases\` must be an array of non-empty strings")
    }
    result.phases = input.phases.map((p) => p.trim())
  }
  return result
}

/**
 * Reads a stored record defensively: the value is durable JSON and may have been
 * written by an older version of this plugin.
 */
function parseRecord(value) {
  if (value === null || typeof value !== "object") return []
  if (!Array.isArray(value.todos)) return []
  const todos = []
  for (const entry of value.todos) {
    if (entry === null || typeof entry !== "object") continue
    if (typeof entry.content !== "string") continue
    if (!TODO_STATUSES.includes(entry.status)) continue
    const todo = { content: entry.content, status: entry.status }
    if (TODO_PRIORITIES.includes(entry.priority)) todo.priority = entry.priority
    if (typeof entry.id === "string" && entry.id !== "") todo.id = entry.id
    if (typeof entry.parentId === "string" && entry.parentId !== "") todo.parentId = entry.parentId
    if (typeof entry.phase === "string" && entry.phase !== "") todo.phase = entry.phase
    if (Array.isArray(entry.dependsOn)) {
      todo.dependsOn = entry.dependsOn.filter((dep) => typeof dep === "string" && dep !== "")
    }
    todos.push(todo)
  }
  return todos
}

function render(todos) {
  if (todos.length === 0) return "(the todo list is empty)"
  return todos
    .map((todo, index) => {
      const phase = todo.phase ? \` [\${todo.phase}]\` : ""
      const priority = todo.priority ? \` — \${todo.priority} priority\` : ""
      return \`\${index + 1}. \${MARK[todo.status]} \${todo.content}\${phase}\${priority}\`
    })
    .join("\\n")
}

const hasOpen = (todos) => todos.some((t) => t.status === "pending" || t.status === "in_progress")

/** Writes atomically so the extension never reads a half-written file. */
async function mirror(sessionID, todos, phases) {
  const dir = mirrorDir()
  await mkdir(dir, { recursive: true })
  const body = { version: 2, sessionID, todos, updatedAt: Date.now() }
  if (Array.isArray(phases) && phases.length) body.phases = phases
  const payload = JSON.stringify(body, null, 2)
  const target = join(dir, \`\${sessionID}.json\`)
  const tmp = join(dir, \`.\${sessionID}.\${process.pid}.tmp\`)
  await writeFile(tmp, payload, "utf8")
  await rename(tmp, target)
  // Keep the board's session index current. Best-effort: the mirror is already
  // durable, so a failed index write must not fail the todo write.
  try {
    await writeIndex(dir)
  } catch {
    /* the board falls back to whatever the index last held */
  }
}

/**
 * The per-session summary the board reads from the index.
 *
 * The board used to \`readFile\` every session mirror just to draw its summary
 * bar, its session labels and each card header. That is O(sessions) reads a
 * poll, which stalls once a machine accumulates a few hundred sessions. The
 * counts below are everything the board needs for those, so it can render them
 * from \`_index.json\` alone and read a mirror only to draw the task tree itself.
 *
 * Pure, so the harness can check the arithmetic without a filesystem.
 */
export function summarize(todos, phases = []) {
  const list = Array.isArray(todos) ? todos : []
  const statusById = new Map()
  for (const todo of list) if (todo && typeof todo.id === "string" && todo.id !== "") statusById.set(todo.id, todo.status)
  let done = 0, doing = 0, pending = 0, cancelled = 0, blocked = 0
  const byPhase = {}
  for (const todo of list) {
    if (todo === null || typeof todo !== "object") continue
    if (todo.status === "completed") done += 1
    else if (todo.status === "in_progress") doing += 1
    else if (todo.status === "pending") pending += 1
    else if (todo.status === "cancelled") cancelled += 1
    if (Array.isArray(todo.dependsOn) && todo.dependsOn.some((dep) => statusById.has(dep) && statusById.get(dep) !== "completed")) blocked += 1
    const key = typeof todo.phase === "string" && todo.phase !== "" ? todo.phase : ""
    byPhase[key] = (byPhase[key] || 0) + 1
  }
  const declared = Array.isArray(phases) ? phases.filter((phase) => typeof phase === "string" && phase !== "") : []
  return { total: list.length, done, doing, pending, cancelled, blocked, byPhase, phases: declared }
}

/** The session label the board shows, derived from the list since a mirror has no title. */
export function titleFor(todos) {
  const list = Array.isArray(todos) ? todos : []
  const active = list.find((todo) => todo && todo.status === "in_progress")
  const root = list.find((todo) => todo && !todo.parentId)
  return (active || root || {}).content || ""
}

/**
 * Writes \`_index.json\`, the list of sessions the board reads.
 *
 * The board's \`filesystem\` grant covers the files (\`todos/*.json\`), not the
 * directory, so the board cannot \`listDir\`. The plugin runs with full access, so
 * it writes the index instead — which keeps the grant file-level.
 *
 * Each entry carries a summary (title, counts, phases) so the board can render
 * its summary bar, its session labels and every card header without opening a
 * single mirror. The summary is recomputed only when a file's mtime moves, so a
 * write stays cheap on a machine with many sessions.
 */
const summaryCache = new Map()

async function summarizeFile(dir, name, mtimeMs) {
  const path = join(dir, name)
  const cached = summaryCache.get(path)
  if (cached && cached.mtimeMs === mtimeMs) return cached.entry
  let entry = null
  try {
    const data = JSON.parse(await readFile(path, "utf8"))
    const todos = parseRecord(data)
    const sessionID = data && typeof data.sessionID === "string" && data.sessionID !== ""
      ? data.sessionID
      : name.slice(0, -".json".length)
    entry = { sessionID, updatedAt: Math.round(mtimeMs), title: titleFor(todos), ...summarize(todos, data && data.phases) }
  } catch {
    /* an unreadable or partial file is skipped this round */
  }
  summaryCache.set(path, { mtimeMs, entry })
  return entry
}

async function writeIndex(dir) {
  let names = []
  try {
    names = await readdir(dir)
  } catch {
    return
  }
  const sessions = []
  const seen = new Set()
  for (const name of names) {
    if (!name.endsWith(".json") || name === INDEX_NAME) continue
    try {
      const info = await stat(join(dir, name))
      const entry = await summarizeFile(dir, name, info.mtimeMs)
      if (entry) {
        sessions.push(entry)
        seen.add(name)
      }
    } catch {
      /* a file that vanished mid-scan is skipped */
    }
  }
  for (const path of summaryCache.keys()) {
    if (!seen.has(path.slice(path.lastIndexOf("/") + 1))) summaryCache.delete(path)
  }
  sessions.sort((a, b) => b.updatedAt - a.updatedAt)
  const payload = JSON.stringify({ version: 2, sessions, updatedAt: Date.now() }, null, 2)
  const tmp = join(dir, \`.\${INDEX_NAME}.\${process.pid}.tmp\`)
  await writeFile(tmp, payload, "utf8")
  await rename(tmp, join(dir, INDEX_NAME))
}

/**
 * The tool description carries the whole behavioral contract.
 *
 * OpenCode's system prompt never mentions todos — in v1 every bit of guidance
 * lived here, in a ~1.6KB description, and that is what made agents reach for
 * the tool on their own. An earlier revision of this plugin condensed it to a
 * few lines and agents stopped using the tool proactively, which is expected:
 * with the contract gone there is nothing telling them when to.
 *
 * This is derived from OpenCode v1's \`tool/todowrite.txt\` (MIT), kept close to
 * the original wording because it is the phrasing that demonstrably worked.
 */
export const TODOWRITE_DESCRIPTION = [
  "Create and maintain a structured task list for the current coding session. Tracks progress, organizes multi-step work, and surfaces status to the user.",
  "",
  "## When to use",
  "Use proactively when:",
  "- The task requires 3+ distinct steps or actions (not just 3 tool calls for a single conceptual step)",
  "- The work is non-trivial and benefits from planning",
  "- The user provides multiple tasks (numbered or comma-separated) or explicitly asks for a todo list",
  "- New instructions arrive - capture them as todos",
  "- You start a task - mark it \`in_progress\` (only one at a time) before working",
  "- You finish a task - mark it \`completed\` and add any follow-ups discovered during the work",
  "",
  "## When NOT to use",
  "Skip when:",
  "- The work is a single, straightforward task (or <3 trivial steps)",
  "- The request is purely informational or conversational",
  "- Tracking adds no organizational value",
  "",
  "## States",
  "- \`pending\` - not started",
  "- \`in_progress\` - actively working (exactly ONE at a time)",
  "- \`completed\` - finished successfully",
  "- \`cancelled\` - no longer needed",
  "",
  "## Rules",
  "- Update status in real time; don't batch completions",
  "- Mark \`completed\` only after the required work is actually done, including any required verification. Never based on intent.",
  "- Keep exactly one \`in_progress\` while work remains",
  "- If blocked or partial, keep it \`in_progress\` and add a follow-up todo describing the blocker",
  "- Preserve user-provided commands verbatim (flags, args, order)",
  "- Items should be specific and actionable; break large work into smaller steps",
  "- Each call replaces the whole list, so always pass every item",
  "",
  "## Structure (optional, for the visual task tree)",
  "- Give each item a short stable \`id\`, and keep it the same across updates.",
  "- Use \`parentId\` to nest a step under the task it belongs to (a subtask); leave it out for a top-level task.",
  "- Use \`phase\` to name the stage a task belongs to (e.g. \\"调研\\", \\"实现\\", \\"验证\\"). Phases are drawn as colour bands.",
  "- \`dependsOn: [ids]\` records a cross-task dependency (shown on the full task board).",
  "- A flat list still works, but a tree is what makes progress legible at a glance.",
  "",
  "When in doubt, use it.",
].join("\\n")

/** How many unchanged injections before the reminder says so outright. */
const STALE_AFTER = 3

/**
 * Builds the per-round reminder.
 *
 * Pure so the harness can check the wording and the escalation without a model
 * or a filesystem. \`repeats\` counts consecutive injections of the same list:
 * once the agent has seen the same list several rounds running, saying so is
 * more useful than repeating the same suggestion.
 */
export function buildReminder(todos, repeats = 1) {
  const lines = [
    "Current todo list for this session:",
    render(todos),
    "",
  ]

  if (repeats >= STALE_AFTER) {
    lines.push(
      \`This list has not changed in \${repeats} rounds. If any of it is finished, update it now with todowrite:\`,
      "- mark finished and verified work \`completed\`",
      "- move the task you are working on to \`in_progress\` (one at a time)",
      "- nest subtasks with \`parentId\` and set each \`phase\`, so the tree stays readable",
    )
  } else {
    lines.push(
      "Keep this list current with todowrite:",
      "- mark a task \`completed\` as soon as it is done and verified",
      "- move the next task to \`in_progress\` before starting it (one at a time)",
      "- capture follow-ups discovered during the work",
      "- keep the tree meaningful: nest subtasks with \`parentId\` and name each task's \`phase\`",
    )
  }

  return lines.join("\\n")
}

const TODOS_INPUT = {
  type: "object",
  properties: {
    phases: {
      type: "array",
      items: { type: "string" },
      description:
        "Optional: the run's stages in order (e.g. [\\"调研\\", \\"实现\\", \\"验证\\"]). Sets the colour order of the task tree.",
    },
    todos: {
      type: "array",
      description: "The complete todo list. This replaces any previous list.",
      items: {
        type: "object",
        properties: {
          content: { type: "string", description: "Brief description of the task." },
          status: { type: "string", enum: TODO_STATUSES, description: "Current state of the task." },
          priority: { type: "string", enum: TODO_PRIORITIES, description: "Optional priority." },
          id: { type: "string", description: "Optional stable id for this task; used to nest subtasks." },
          parentId: { type: "string", description: "Optional id of the parent task, to nest this as a subtask." },
          phase: { type: "string", description: "Optional stage name; phases are drawn as colour bands." },
          dependsOn: { type: "array", items: { type: "string" }, description: "Optional ids this task depends on." },
        },
        required: ["content", "status"],
        additionalProperties: false,
      },
    },
  },
  required: ["todos"],
  additionalProperties: false,
}

const EMPTY_INPUT = { type: "object", properties: {}, additionalProperties: false }

export default {
  id: "openchamber-todo-bridge",

  async setup(ctx) {
    // Refresh/upgrade \`_index.json\` once at load, so the board gets its per-session
    // summaries even before the first todowrite of a session — and an index left
    // over from an older plugin (no summaries) is rewritten on the next start.
    try {
      await writeIndex(mirrorDir())
    } catch {
      /* best-effort: the board falls back to reading mirrors */
    }

    const tools = await ctx.tool.transform((editor) => {
      editor.add({
        name: "todowrite",
        description: TODOWRITE_DESCRIPTION,
        input: TODOS_INPUT,
        options: { codemode: false },
        async execute(input, context) {
          const { todos, phases } = normalize(input)
          await ctx.storage.set(storageKey(context.sessionID), { todos, phases: phases || [], updatedAt: Date.now() })
          // Mirror after the durable write: a mirror failure must not lose the list.
          try {
            await mirror(context.sessionID, todos, phases)
          } catch {
            /* the list is already stored; the panel is best-effort */
          }
          return {
            content: \`Todo list updated (\${todos.length} \${todos.length === 1 ? "item" : "items"}):\\n\${render(todos)}\`,
          }
        },
      })

      editor.add({
        name: "todoread",
        description:
          "Read the current session todo list. Use it to recover the list after context compaction or to check progress before starting the next task.",
        input: EMPTY_INPUT,
        options: { codemode: false },
        async execute(_input, context) {
          const todos = parseRecord(await ctx.storage.get(storageKey(context.sessionID)))
          return { content: \`Current todo list:\\n\${render(todos)}\` }
        },
      })
    })

    // Re-inject the current list each round. Two reasons: compaction can drop
    // the older tool results, and without a reminder a long task tends to run to
    // the end with the list still showing everything as pending.
    //
    // The list is compared by content, so an unchanged list is detected without
    // asking the model anything. After a few unchanged rounds the reminder says
    // so outright rather than repeating the same suggestion.
    const seen = new Map()
    const context = await ctx.session.hook("context", async (event) => {
      const todos = parseRecord(await ctx.storage.get(storageKey(event.sessionID)))
      if (!hasOpen(todos)) {
        seen.delete(event.sessionID)
        return
      }

      const key = JSON.stringify(todos)
      const previous = seen.get(event.sessionID)
      const repeats = previous && previous.key === key ? previous.repeats + 1 : 1
      seen.set(event.sessionID, { key, repeats })

      event.system.push({ type: "text", text: buildReminder(todos, repeats) })
    })

    return async () => {
      await context.dispose()
      await tools.dispose()
    }
  },
}
`;
  var MANIFEST = `{
  "name": "openchamber-todo-bridge-plugin",
  "version": "0.9.1",
  "private": true,
  "type": "module",
  "description": "OpenCode plugin half of openchamber-todo-bridge: restores todowrite/todoread and mirrors the list to a file an OpenChamber extension can read.",
  "exports": {
    ".": "./index.js"
  }
}
`;
  var PLUGIN_VERSION = (() => {
    try {
      return JSON.parse(MANIFEST).version || "0.0.0";
    } catch {
      return "0.0.0";
    }
  })();
  var VERSION_MARKER = `
// ${PLUGIN_ID}@${PLUGIN_VERSION}
`;
  var ENTRY_CONTENT = SOURCE + VERSION_MARKER;
  var markerFor = (version) => `
// ${PLUGIN_ID}@${version}
`;
  function versionFromMarker(entry) {
    const match = new RegExp(`\\n// ${PLUGIN_ID}@([^\\n]+)\\n$`).exec(entry);
    return match ? match[1].trim() : null;
  }
  function compareVersions(a, b) {
    const parse = (value) => {
      const match = /^(\d+)\.(\d+)\.(\d+)/.exec(String(value));
      return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
    };
    const left = parse(a);
    const right = parse(b);
    if (!left || !right)
      return null;
    for (let i = 0;i < 3; i += 1) {
      if (left[i] !== right[i])
        return left[i] < right[i] ? -1 : 1;
    }
    return 0;
  }
  function planInstall(entry, current = PLUGIN_VERSION) {
    if (typeof entry !== "string")
      return { action: "write", reason: "missing" };
    if (!entry.includes(PLUGIN_ID))
      return { action: "write", reason: "foreign" };
    if (entry.endsWith(markerFor(current)))
      return { action: "none", reason: "current" };
    const onDisk = versionFromMarker(entry);
    if (onDisk && compareVersions(onDisk, current) > 0)
      return { action: "none", reason: "newer-on-disk" };
    return { action: "write", reason: "outdated" };
  }
  async function ensureInstalled(host) {
    const result = { ok: false, reason: "", version: PLUGIN_VERSION };
    if (!SOURCE || !MANIFEST) {
      return { ...result, reason: "build-missing-source" };
    }
    let entry = null;
    try {
      entry = (await host.readFile(PLUGIN_ENTRY_PATH)).content;
    } catch (error) {
      const code = error && error.code;
      if (code !== "NOT_FOUND") {
        return { ...result, reason: `read-failed:${code || "unknown"}` };
      }
    }
    const plan = planInstall(entry);
    if (plan.action === "none")
      return { ok: true, reason: "current", version: PLUGIN_VERSION };
    try {
      await host.writeFile(PLUGIN_ENTRY_PATH, ENTRY_CONTENT);
      await host.writeFile(PLUGIN_MANIFEST_PATH, MANIFEST);
    } catch (error) {
      const code = error && error.code;
      return { ...result, reason: `write-failed:${code || "unknown"}` };
    }
    return { ok: true, reason: plan.reason, version: PLUGIN_VERSION };
  }

  // src/main.js
  var POLL_MS = 2000;
  var REQUEST_TIMEOUT_MS = 3000;
  var BOOT_WATCHDOG_MS = 1600;
  var ROW_ENTER_MS = 180;
  var ROW_TOGGLE_MS = 220;
  var COMPLETION_STRIKE_MS = 180;
  var COMPLETION_FLIGHT_MS = 220;
  var TYPEWRITER_STEP_MS = 14;
  var TYPEWRITER_CHAR_MS = 18;
  var TYPEWRITER_DELAY_CAP_MS = 2200;
  var TYPEWRITER_CLEANUP_MIN_MS = 300;
  var MOVE_STAGGER_MS = 30;
  var MOVE_STAGGER_CAP_MS = 90;
  var ENTER_STAGGER_MS = 40;
  var ENTER_STAGGER_CAP_MS = 160;
  var MOTION_EASING = "linear(0, 0.03 3.1%, 0.106 6.3%, 0.211 9.4%, 0.333 12.5%, 0.459 15.6%, 0.582 18.8%, 0.695 21.9%, 0.795 25%, 0.88 28.1%, 0.949 31.3%, 1.002 34.4%, 1.041 37.5%, 1.067 40.6%, 1.082 43.8%, 1.089 46.9%, 1.088 50%, 1.083 53.1%, 1.075 56.3%, 1.065 59.4%, 1.053 62.5%, 1.042 65.6%, 1.032 68.8%, 1.022 71.9%, 1.014 75%, 1.007 78.1%, 1.002 81.3%, 0.998 84.4%, 0.995 87.5%, 0.993 90.6%, 0.992 93.8%, 0.992 96.9%, 0.992 100%)";
  var MOTION_EASING_PULSE = "linear(0, 0.038 3.1%, 0.137 6.3%, 0.275 9.4%, 0.434 12.5%, 0.597 15.6%, 0.752 18.8%, 0.889 21.9%, 1.002 25%, 1.089 28.1%, 1.15 31.3%, 1.185 34.4%, 1.199 37.5%, 1.196 40.6%, 1.179 43.8%, 1.153 46.9%, 1.122 50%, 1.089 53.1%, 1.057 56.3%, 1.029 59.4%, 1.005 62.5%, 0.986 65.6%, 0.973 68.8%, 0.964 71.9%, 0.96 75%, 0.96 78.1%, 0.963 81.3%, 0.968 84.4%, 0.974 87.5%, 0.98 90.6%, 0.987 93.8%, 0.993 96.9%, 0.998 100%)";
  var MANIFEST_H = 56;
  var UI_ONLY = false;
  var IDLE_MS = 1e4;
  var SNAP_QUIET_MS = 110;
  var HEIGHT_DELTA = 8;
  var HEIGHT_SETTLE_MS = 150;
  var PRIORITY_CLASS = { high: "high", medium: "medium", low: "low" };
  var PRIORITY_MARK = {
    high: "⌃⌃",
    medium: "⌃",
    low: "·"
  };
  var el2 = (id) => document.getElementById(id);
  var host = null;
  var sessionID = null;
  var timer = null;
  var lastKey = "";
  var refreshSequence = 0;
  var booted = false;
  var installChecked = false;
  var setupNote = "";
  var openFinished = false;
  var finishedFor = null;
  var observedTaskSession = null;
  var previousTaskKeys = new Set;
  var pendingTypewriterKeys = new Set;
  var completedAtEnd = new Map;
  var completionSequence = 0;
  var motionEpoch = 0;
  var completionTransitions = new Map;
  var exitingRows = new Set;
  var completionGhosts = new Set;
  var suppressAnimationsForNextPaint = true;
  var painted = [];
  var paintedPhases = [];
  var lastHeight = MANIFEST_H;
  var heightTimer = null;
  var idleTimer = null;
  var snapTimer = null;
  function file(sessionID2) {
    return `~/.config/openchamber/todos/${sessionID2}.json`;
  }
  function esc(value) {
    return String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  }
  function order(list) {
    const rank = { in_progress: 0, pending: 1 };
    return list.map((todo, index) => ({ todo, index })).sort((a, b) => {
      const ra = rank[a.todo.status] ?? 9;
      const rb = rank[b.todo.status] ?? 9;
      return ra === rb ? a.index - b.index : ra - rb;
    }).map((entry) => entry.todo);
  }
  function statusMarkHtml(status) {
    if (status === "completed")
      return '<span class="tick"></span>';
    if (status === "in_progress")
      return '<span class="dot"></span>';
    if (status === "cancelled")
      return '<span class="dash"></span>';
    return "";
  }
  function textHtml(content, typing) {
    if (!typing)
      return `<span class="txt">${esc(content)}</span>`;
    const segmenter = typeof Intl !== "undefined" && typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;
    const characters = segmenter ? Array.from(segmenter.segment(content), (part) => part.segment) : Array.from(content);
    const chars = characters.map((character, index) => `<span class="type-char" aria-hidden="true" style="--type-delay:${Math.min(index * TYPEWRITER_STEP_MS, TYPEWRITER_DELAY_CAP_MS)}ms">${esc(character)}</span>`).join("");
    return `<span class="txt typewriter" role="text" aria-label="${esc(content)}">${chars}</span>`;
  }
  function normalizeTypewriter(text) {
    const content = text.getAttribute("aria-label") ?? text.textContent;
    text.classList.remove("typewriter");
    text.removeAttribute("role");
    text.removeAttribute("aria-label");
    text.textContent = content;
  }
  function normalizeTypewriters(body) {
    for (const text of body.querySelectorAll(".txt.typewriter"))
      normalizeTypewriter(text);
  }
  function scheduleTypewriterCleanup(node, content) {
    const chars = Array.from(content).length;
    const settle = Math.min(Math.max(chars - 1, 0) * TYPEWRITER_STEP_MS, TYPEWRITER_DELAY_CAP_MS) + TYPEWRITER_CHAR_MS;
    setTimeout(() => {
      const text = node.querySelector(".txt.typewriter");
      if (!text || !node.isConnected || text.textContent !== content)
        return;
      normalizeTypewriter(text);
    }, Math.max(settle + 80, TYPEWRITER_CLEANUP_MIN_MS));
  }
  function priorityHtml(todo) {
    const mark = PRIORITY_MARK[todo.priority] || "";
    if (!mark)
      return "";
    return `<span class="pri ${PRIORITY_CLASS[todo.priority] || ""}">${mark}</span>`;
  }
  function itemHtml(todo, key, typing = false, tree = null) {
    const pri = priorityHtml(todo);
    if (tree && tree.synthetic) {
      const width = tree.depth * INDENT + GUT_NODE;
      return `<div class="item tree group" data-row-key="${esc(key)}" data-status=""` + ` data-depth="${tree.depth}" data-last="${tree.isLast ? 1 : 0}" data-color="${tree.colorIndex}">` + `<span class="gut" style="width:${width}px">${gutterSvg(tree, "")}</span>` + `<span class="txt group-label" style="color:${phaseColor(tree.colorIndex)}">${esc(todo.content)}</span></div>`;
    }
    if (tree) {
      const width = tree.depth * INDENT + GUT_NODE;
      return `<div class="item tree ${esc(todo.status)}" data-row-key="${esc(key)}" data-status="${esc(todo.status)}"` + ` data-depth="${tree.depth}" data-last="${tree.isLast ? 1 : 0}" data-color="${tree.colorIndex}">` + `<span class="gut" style="width:${width}px">${gutterSvg(tree, todo.status)}</span>` + `${textHtml(todo.content, typing)}${pri}</div>`;
    }
    return `<div class="item ${esc(todo.status)}" data-row-key="${esc(key)}" data-status="${esc(todo.status)}">` + `<span class="box">${statusMarkHtml(todo.status)}</span>` + `${textHtml(todo.content, typing)}${pri}</div>`;
  }
  function rowKeys(list) {
    const occurrences = new Map;
    return list.map((todo) => {
      const occurrence = occurrences.get(todo.content) || 0;
      occurrences.set(todo.content, occurrence + 1);
      return `item:${JSON.stringify([todo.content, occurrence])}`;
    });
  }
  function buildRows(list) {
    const keys = rowKeys(list);
    const keyOf = new Map(list.map((todo, index) => [todo, keys[index]]));
    const open = order(list.filter((todo) => !isFinished(todo)));
    const finished = list.filter(isFinished).sort((a, b) => {
      const aOrder = completedAtEnd.get(keyOf.get(a));
      const bOrder = completedAtEnd.get(keyOf.get(b));
      if (aOrder === undefined && bOrder === undefined)
        return 0;
      if (aOrder === undefined)
        return -1;
      if (bOrder === undefined)
        return 1;
      return aOrder - bOrder;
    });
    const rows = open.map((todo) => ({ kind: "item", status: todo.status, key: keyOf.get(todo), todo }));
    if (finished.length) {
      const expanded = openFinished && finishedFor === sessionID;
      rows.push({ kind: "fold", status: "fold", key: "fold", count: finished.length, expanded });
      if (expanded) {
        for (const todo of finished) {
          rows.push({ kind: "item", status: todo.status, key: keyOf.get(todo), todo });
        }
      }
    }
    return rows;
  }
  function treeRows(list, phases) {
    const keys = rowKeys(list);
    const keyOf = new Map(list.map((todo, index) => [todo, keys[index]]));
    const kept = pruneFinished(list);
    const expanded = openFinished && finishedFor === sessionID;
    const shown = expanded ? list : kept;
    const { rows } = buildTree(shown, phases);
    const out = rows.map((tree) => {
      const todo = tree.synthetic ? { content: tree.content, status: "", priority: "", phase: tree.phase } : shown[tree.index];
      const key = tree.synthetic ? tree.key : keyOf.get(todo);
      return { kind: "item", status: tree.status, key, todo, tree };
    });
    const hidden = list.length - kept.length;
    if (hidden) {
      out.push({ kind: "fold", status: "fold", key: "fold", count: hidden, expanded });
    }
    return out;
  }
  function currentRows() {
    if (!painted.length)
      return [];
    return hasStructure(painted) ? treeRows(painted, paintedPhases) : buildRows(painted);
  }
  function rowHtml(row, typing = false) {
    if (row.kind === "fold") {
      return `<button class="fold" type="button" data-row-key="fold" data-count="${row.count}" aria-expanded="${row.expanded}">已完成 <span class="n">${row.count}</span> 项</button>`;
    }
    return itemHtml(row.todo, row.key, typing, row.tree || null);
  }
  function createRowNode(row, typing = false) {
    const template = document.createElement("template");
    template.innerHTML = rowHtml(row, typing);
    return template.content.firstElementChild;
  }
  function updateRowNode(node, row, animateStatus = true) {
    if (row.kind === "fold") {
      const expanded = String(row.expanded);
      if (node.getAttribute("aria-expanded") !== expanded)
        node.setAttribute("aria-expanded", expanded);
      const count = String(row.count);
      if (node.dataset.count !== count) {
        const grew = node.dataset.count !== "" && Number(count) > Number(node.dataset.count);
        node.dataset.count = count;
        const n = node.querySelector(".n");
        if (n) {
          n.textContent = count;
          if (grew && !reducedMotion())
            animateCountFlip(n);
        } else {
          node.textContent = `已完成 ${row.count} 项`;
        }
      }
      return;
    }
    const todo = row.todo;
    const previousStatus = node.dataset.status;
    if (node.dataset.rowKey !== row.key)
      node.dataset.rowKey = row.key;
    if (previousStatus !== todo.status) {
      node.dataset.status = todo.status;
      node.className = row.tree ? row.tree.synthetic ? "item tree group" : `item tree ${todo.status}` : `item ${todo.status}`;
      node.removeAttribute("data-completion-phase");
    }
    const text = node.querySelector(".txt");
    if (text.textContent !== todo.content)
      text.textContent = todo.content;
    const recolor = row.tree && node.dataset.color !== String(row.tree.colorIndex);
    if (previousStatus !== todo.status || recolor) {
      if (row.tree) {
        node.dataset.color = String(row.tree.colorIndex);
        const gut = node.querySelector(".gut");
        if (gut)
          gut.innerHTML = gutterSvg(row.tree, todo.status);
        if (previousStatus !== todo.status && animateStatus && todo.status === "completed" && !reducedMotion()) {
          const tick = node.querySelector(".gut .gut-tick");
          if (tick) {
            node.classList.add("just-completed");
            tick.addEventListener("animationend", () => node.classList.remove("just-completed"), { once: true });
          }
        }
      } else {
        const box = node.querySelector(".box");
        box.innerHTML = statusMarkHtml(todo.status);
        if (animateStatus && todo.status === "completed" && !reducedMotion()) {
          const tick = box.querySelector(".tick");
          if (tick) {
            node.classList.add("just-completed");
            tick.addEventListener("animationend", () => node.classList.remove("just-completed"), { once: true });
          }
        }
      }
    }
    const mark = PRIORITY_MARK[todo.priority] || "";
    let priority = node.querySelector(".pri");
    if (!mark) {
      priority?.remove();
    } else {
      if (!priority) {
        priority = document.createElement("span");
        node.append(priority);
      }
      const className = `pri ${PRIORITY_CLASS[todo.priority] || ""}`;
      if (priority.className !== className)
        priority.className = className;
      if (priority.textContent !== mark)
        priority.textContent = mark;
    }
  }
  function taskKeys(list) {
    const occurrences = new Map;
    return new Set(list.map((todo) => {
      const occurrence = occurrences.get(todo.content) || 0;
      occurrences.set(todo.content, occurrence + 1);
      return `item:${JSON.stringify([todo.content, occurrence])}`;
    }));
  }
  function rememberTaskKeys(list) {
    const current = taskKeys(list);
    if (observedTaskSession === sessionID) {
      for (const key of current) {
        if (!previousTaskKeys.has(key))
          pendingTypewriterKeys.add(key);
      }
    } else {
      pendingTypewriterKeys.clear();
    }
    for (const key of pendingTypewriterKeys) {
      if (!current.has(key))
        pendingTypewriterKeys.delete(key);
    }
    for (const key of completedAtEnd.keys()) {
      if (!current.has(key))
        completedAtEnd.delete(key);
    }
    previousTaskKeys = current;
    observedTaskSession = sessionID;
    return pendingTypewriterKeys;
  }
  function cancelRowAnimations() {
    motionEpoch += 1;
    const body = el2("body");
    for (const animation of body.getAnimations({ subtree: true })) {
      if (animation.effect?.getComputedTiming?.().iterations !== Infinity)
        animation.cancel();
    }
    for (const node of body.querySelectorAll(".just-completed"))
      node.classList.remove("just-completed");
    for (const { node, row } of completionTransitions.values()) {
      completedAtEnd.set(row.key, ++completionSequence);
      node.querySelector(".strike-sweep")?.remove();
      node.classList.remove("completion-marking");
      node.removeAttribute("data-completion-phase");
      if (node.isConnected)
        updateRowNode(node, row, false);
    }
    completionTransitions.clear();
    for (const node of exitingRows) {
      node.classList.remove("row-exiting");
      node.removeAttribute("data-exiting");
      node.remove();
    }
    exitingRows.clear();
    for (const ghost of completionGhosts)
      ghost.remove();
    completionGhosts.clear();
    normalizeTypewriters(body);
  }
  function animateRow(node, from, to, duration, onFinish, delay = 0) {
    const epoch = motionEpoch;
    const animation = node.animate([from, to], {
      duration,
      delay,
      easing: MOTION_EASING,
      fill: "both"
    });
    animation.finished.then(() => {
      animation.cancel();
      if (epoch === motionEpoch && onFinish)
        onFinish();
    }, () => {});
    return animation;
  }
  function animateCountFlip(n) {
    animateRow(n, { transform: "translateY(5px)", opacity: 0 }, { transform: "translateY(0)", opacity: 1 }, ROW_TOGGLE_MS);
  }
  function pulseFold(fold) {
    if (!fold || reducedMotion())
      return;
    const animation = fold.animate([{ transform: "scale(1)" }, { transform: "scale(1.05)", offset: 0.4 }, { transform: "scale(1)" }], { duration: 300, easing: MOTION_EASING_PULSE, fill: "none" });
    animation.finished.then(() => animation.cancel(), () => {});
  }
  function animateRowEnter(node, delay = 0) {
    const height = node.getBoundingClientRect().height;
    const style = getComputedStyle(node);
    animateRow(node, { height: "0px", opacity: 0, transform: "translateY(-4px)", paddingTop: "0px", paddingBottom: "0px", overflow: "hidden" }, { height: `${height}px`, opacity: 1, transform: "translateY(0)", paddingTop: style.paddingTop, paddingBottom: style.paddingBottom, overflow: "hidden" }, ROW_TOGGLE_MS, undefined, delay);
  }
  function animateRowExit(node, epoch) {
    const height = node.getBoundingClientRect().height;
    const style = getComputedStyle(node);
    node.classList.add("row-exiting");
    node.dataset.exiting = "true";
    exitingRows.add(node);
    const animation = node.animate([
      { height: `${height}px`, opacity: 1, transform: "translateY(0)", paddingTop: style.paddingTop, paddingBottom: style.paddingBottom, overflow: "hidden" },
      { height: "0px", opacity: 0, transform: "translateY(-4px)", paddingTop: "0px", paddingBottom: "0px", overflow: "hidden" }
    ], { duration: ROW_TOGGLE_MS, easing: MOTION_EASING, fill: "both" });
    animation.finished.then(() => {
      animation.cancel();
      if (epoch !== motionEpoch)
        return;
      exitingRows.delete(node);
      node.remove();
      if (exitingRows.size === 0)
        applyListHeight(true);
    }, () => {});
  }
  function completionGhost(body, source, row) {
    const sourceRect = source.getBoundingClientRect();
    const bodyRect = body.getBoundingClientRect();
    const ghost = source.cloneNode(true);
    updateRowNode(ghost, row, false);
    const ghostText = ghost.querySelector(".txt.typewriter");
    if (ghostText)
      normalizeTypewriter(ghostText);
    ghost.classList.add("completion-ghost");
    ghost.removeAttribute("data-row-key");
    ghost.dataset.motionOnly = "true";
    ghost.setAttribute("aria-hidden", "true");
    ghost.inert = true;
    ghost.style.position = "absolute";
    ghost.style.left = `${sourceRect.left - bodyRect.left + body.scrollLeft}px`;
    ghost.style.top = `${sourceRect.top - bodyRect.top + body.scrollTop}px`;
    ghost.style.width = `${sourceRect.width}px`;
    ghost.style.height = `${sourceRect.height}px`;
    ghost.style.margin = "0";
    ghost.style.zIndex = "2";
    ghost.style.pointerEvents = "none";
    body.append(ghost);
    completionGhosts.add(ghost);
    return { ghost, sourceRect };
  }
  function animateCompletionGhosts(body, ghosts) {
    const fold = Array.from(body.children).find((node) => node.dataset.rowKey === "fold");
    if (!fold) {
      for (const { ghost } of ghosts) {
        completionGhosts.delete(ghost);
        ghost.remove();
      }
      return;
    }
    const target = fold.getBoundingClientRect();
    let landed = false;
    for (const { ghost, sourceRect } of ghosts) {
      const deltaX = target.left - sourceRect.left;
      const deltaY = target.top - sourceRect.top;
      animateRow(ghost, { transform: "translate(0, 0) scale(1)", opacity: 1 }, { transform: `translate(${deltaX}px, ${deltaY}px) scale(.82)`, opacity: 0 }, COMPLETION_FLIGHT_MS, () => {
        completionGhosts.delete(ghost);
        ghost.remove();
        if (!landed) {
          landed = true;
          pulseFold(fold);
        }
      });
    }
  }
  function finishCompletionTransitions(entries, animateStructure) {
    const epoch = motionEpoch;
    const animations = entries.map(({ node, row }) => {
      completionTransitions.set(row.key, { node, row });
      node.classList.add("completion-marking");
      node.dataset.completionPhase = "strike";
      const sweep = document.createElement("span");
      sweep.className = "strike-sweep";
      sweep.setAttribute("aria-hidden", "true");
      node.querySelector(".txt").append(sweep);
      return sweep.animate([{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], { duration: COMPLETION_STRIKE_MS, easing: "linear", fill: "both" });
    });
    Promise.all(animations.map((animation) => animation.finished.catch(() => null))).then(() => {
      for (const animation of animations)
        animation.cancel();
      if (epoch !== motionEpoch)
        return;
      for (const { node, row } of entries) {
        completedAtEnd.set(row.key, ++completionSequence);
        completionTransitions.delete(row.key);
        node.querySelector(".strike-sweep")?.remove();
        node.classList.remove("completion-marking");
        node.removeAttribute("data-completion-phase");
      }
      const foldCollapsed = !(openFinished && finishedFor === sessionID);
      const ghostRows = foldCollapsed ? new Map(entries.map(({ row }) => [row.key, row])) : new Map;
      const result = reconcileRows(currentRows(), {
        animate: animateStructure,
        newTaskKeys: pendingTypewriterKeys,
        skipCompletionDetection: true,
        ghostRows
      });
      applyListHeight(result.entering.length > 0);
    });
  }
  function reconcileRows(rows, options = {}) {
    const body = el2("body");
    const animate = options.animate !== false && !reducedMotion();
    const previous = Array.from(body.children).filter((node) => node.dataset.motionOnly !== "true");
    const byKey = new Map(previous.filter((node) => node.dataset.rowKey).map((node) => [node.dataset.rowKey, node]));
    if (animate && !options.skipCompletionDetection) {
      const occurrences = new Map;
      const completing = painted.filter((todo) => todo.status === "completed").map((todo) => {
        const occurrence = occurrences.get(todo.content) || 0;
        occurrences.set(todo.content, occurrence + 1);
        const row = { kind: "item", status: todo.status, key: `item:${JSON.stringify([todo.content, occurrence])}`, todo };
        return { node: byKey.get(row.key), row };
      }).filter(({ node }) => node && node.dataset.status !== "completed");
      if (completing.length) {
        finishCompletionTransitions(completing, animate);
        return { staged: true, entering: [] };
      }
    }
    const firstTops = new Map(previous.map((node) => [node, node.getBoundingClientRect().top]));
    const used = new Set;
    const entering = [];
    let cursor = body.firstElementChild;
    while (cursor && cursor.dataset.motionOnly === "true")
      cursor = cursor.nextElementSibling;
    for (const row of rows) {
      let node = byKey.get(row.key);
      if (node) {
        updateRowNode(node, row);
      } else {
        const isNewTask = row.kind === "item" && options.newTaskKeys?.has(row.key);
        node = createRowNode(row, isNewTask && animate);
        if (isNewTask) {
          pendingTypewriterKeys.delete(row.key);
          if (animate)
            scheduleTypewriterCleanup(node, row.todo.content);
        }
        entering.push(node);
      }
      used.add(node);
      if (node !== cursor)
        body.insertBefore(node, cursor);
      else
        cursor = cursor.nextElementSibling;
      while (cursor && cursor.dataset.motionOnly === "true")
        cursor = cursor.nextElementSibling;
    }
    const ghosts = [];
    const epoch = motionEpoch;
    for (const node of previous) {
      if (used.has(node))
        continue;
      const ghostRow = options.ghostRows?.get(node.dataset.rowKey);
      if (ghostRow) {
        ghosts.push(completionGhost(body, node, ghostRow));
        node.remove();
      } else if (animate) {
        animateRowExit(node, epoch);
      } else {
        node.remove();
      }
    }
    if (ghosts.length)
      animateCompletionGhosts(body, ghosts);
    animateRows(body, firstTops, entering, previous.some((node) => node.dataset.rowKey), used, animate);
    return { staged: false, entering };
  }
  function animateRows(body, firstTops, entering, hadRows, used, animate) {
    if (!animate || reducedMotion())
      return;
    let moveIndex = 0;
    for (const [node, firstTop] of firstTops) {
      if (!used.has(node) || !node.isConnected)
        continue;
      const deltaY = firstTop - node.getBoundingClientRect().top;
      if (Math.abs(deltaY) < 1)
        continue;
      animateRow(node, { transform: `translateY(${deltaY}px)` }, { transform: "translateY(0)" }, ROW_ENTER_MS, undefined, Math.min(moveIndex++ * MOVE_STAGGER_MS, MOVE_STAGGER_CAP_MS));
    }
    if (hadRows && entering.length > 0) {
      const epoch = motionEpoch;
      requestAnimationFrame(() => {
        if (epoch !== motionEpoch || reducedMotion())
          return;
        entering.forEach((node, index) => {
          if (node.isConnected)
            animateRowEnter(node, Math.min(index * ENTER_STAGGER_MS, ENTER_STAGGER_CAP_MS));
        });
      });
    }
  }
  var rowNodes = () => Array.from(el2("body").children).filter((node) => node.dataset.motionOnly !== "true");
  function canScroll() {
    const body = el2("body");
    return body.scrollHeight > body.clientHeight + 1;
  }
  var reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var smooth = () => reducedMotion() ? "auto" : "smooth";
  function frameHeight(headerH) {
    const rows = rowNodes();
    if (rows.length === 0)
      return MIN_H;
    const last = rows[rows.length - 1];
    const content = last.offsetTop + last.offsetHeight;
    return clamp(headerH + Math.round(content) + bodyPadding(), MIN_H, MAX_H);
  }
  function applyHeight(height, immediate = false) {
    const wanted = clamp(height, MIN_H, MAX_H);
    if (wanted === lastHeight)
      return;
    const first = lastHeight === MANIFEST_H;
    if (!first && Math.abs(wanted - lastHeight) < HEIGHT_DELTA)
      return;
    clearTimeout(heightTimer);
    heightTimer = setTimeout(() => {
      heightTimer = null;
      if (wanted === lastHeight)
        return;
      lastHeight = wanted;
      try {
        if (host)
          host.setHeight(wanted).catch(() => {});
      } catch {
        lastHeight = MANIFEST_H;
      }
    }, first || immediate ? 0 : HEIGHT_SETTLE_MS);
  }
  function applyListHeight(immediate = false) {
    const top = el2("top");
    applyHeight(frameHeight(top.offsetHeight || 22), immediate);
  }
  function snap() {
    snapTimer = null;
    const body = el2("body");
    const max = body.scrollHeight - body.clientHeight;
    if (max <= 0)
      return;
    const here = body.scrollTop;
    const starts = rowNodes().map((node) => node.offsetTop);
    const rowTarget = clampScroll(starts[nearestIndex(here, starts)], max);
    const target = Math.max(0, max - here) < Math.abs(rowTarget - here) ? max : rowTarget;
    if (Math.abs(target - here) < 1)
      return;
    body.scrollTo({ top: target, behavior: smooth() });
  }
  function returnToWork() {
    idleTimer = null;
    const body = el2("body");
    if (body.scrollTop <= 1)
      return;
    body.scrollTo({ top: 0, behavior: smooth() });
  }
  function clearIdle() {
    if (idleTimer === null)
      return;
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  function armIdle() {
    clearIdle();
    if (!canScroll())
      return;
    idleTimer = setTimeout(returnToWork, IDLE_MS);
  }
  var SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "]);
  function wireInput() {
    const body = el2("body");
    let pointerDown = false;
    body.addEventListener("click", (event) => {
      const fold = event.target instanceof Element ? event.target.closest(".fold") : null;
      if (!fold)
        return;
      openFinished = !(openFinished && finishedFor === sessionID);
      finishedFor = sessionID;
      lastKey = "";
      if (painted.length)
        paint(painted, paintedPhases);
    });
    body.addEventListener("scroll", () => {
      if (pointerDown)
        armIdle();
      clearTimeout(snapTimer);
      snapTimer = setTimeout(snap, SNAP_QUIET_MS);
    }, { passive: true });
    body.addEventListener("wheel", armIdle, { passive: true });
    body.addEventListener("touchmove", armIdle, { passive: true });
    body.addEventListener("keydown", (event) => {
      if (SCROLL_KEYS.has(event.key))
        armIdle();
    });
    body.addEventListener("pointerdown", () => {
      pointerDown = true;
    });
    const releaseDrag = () => {
      pointerDown = false;
    };
    window.addEventListener("pointerup", releaseDrag);
    window.addEventListener("pointercancel", releaseDrag);
    window.addEventListener("blur", releaseDrag);
  }
  function bodyPadding() {
    const style = getComputedStyle(el2("body"));
    return Math.round((parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0));
  }
  function legendHtml(phases) {
    return phases.map((phase, index) => `<span class="lg"><i style="background:${phaseColor(index)}"></i>${esc(phase)}</span>`).join("");
  }
  function paint(todos, phases = []) {
    cancelRowAnimations();
    if (!todos.length) {
      rememberTaskKeys(todos);
      paintPlain('<div class="empty">No todos for this session.</div>');
      return;
    }
    painted = todos;
    paintedPhases = phases;
    const structured = hasStructure(todos);
    const newTaskKeys = rememberTaskKeys(todos);
    const animate = !suppressAnimationsForNextPaint;
    suppressAnimationsForNextPaint = false;
    el2("root").dataset.mode = "work";
    const view = structured ? "tree" : "flat";
    if (el2("root").dataset.view && el2("root").dataset.view !== view) {
      el2("body").innerHTML = "";
    }
    el2("root").dataset.view = view;
    const top = el2("top");
    const done = todos.filter(isFinished).length;
    top.dataset.empty = "false";
    el2("count").textContent = `${done}/${todos.length}`;
    top.querySelector("#bar").dataset.full = done > 0 && done === todos.length ? "true" : "false";
    top.querySelector("#bar > i").style.transform = `scaleX(${done / todos.length})`;
    const legend = el2("legend");
    if (structured && phases.length) {
      legend.innerHTML = legendHtml(phases);
      legend.hidden = false;
    } else {
      legend.innerHTML = "";
      legend.hidden = true;
    }
    const result = reconcileRows(currentRows(), { animate, newTaskKeys });
    if (!result.staged)
      applyListHeight(result.entering.length > 0);
  }
  function paintPlain(html) {
    cancelRowAnimations();
    painted = [];
    paintedPhases = [];
    const legend = el2("legend");
    if (legend) {
      legend.innerHTML = "";
      legend.hidden = true;
    }
    clearIdle();
    clearTimeout(snapTimer);
    snapTimer = null;
    clearTimeout(heightTimer);
    heightTimer = null;
    el2("root").dataset.mode = "empty";
    el2("top").dataset.empty = "true";
    el2("body").innerHTML = html;
    el2("body").scrollTop = 0;
    applyHeight(Math.max(MIN_H, Math.round(el2("body").offsetHeight)));
  }
  function paintMessage(text) {
    paintPlain(`<div class="empty">${esc(text)}</div>`);
  }
  function paintSetupNote(reason) {
    const lead = reason === "write-failed" ? "Could not install the OpenCode plugin." : "OpenCode plugin installed.";
    const detail = reason === "write-failed" ? `The section stays empty until it is there. Install it by hand from <code>opencode-plugin/</code> in the repo.` : `Send any message in this session to start a fresh turn — it loads without a restart. Written to <code>${esc(PLUGIN_DIR_PATH)}</code>.`;
    paintPlain(`<div class="empty"><b>${lead}</b><br>${detail}</div>`);
  }
  async function refresh() {
    if (!host)
      return;
    if (!sessionID) {
      refreshSequence += 1;
      paintMessage("No session.");
      return;
    }
    const sequence = ++refreshSequence;
    const requestedSessionID = sessionID;
    const isCurrent = () => sequence === refreshSequence && requestedSessionID === sessionID;
    let content;
    try {
      const result = await host.readFile(file(requestedSessionID));
      content = result && result.content;
    } catch (error) {
      if (!isCurrent())
        return;
      const code = error && error.code;
      if (code === "NOT_GRANTED") {
        paintMessage("This section was not allowed to read the todo file.");
        stop();
        return;
      }
      if (code === "DISABLED" || code === "HOST_UNAVAILABLE") {
        paintMessage("Todo data is not available.");
        stop();
        return;
      }
      if (error instanceof Error && error.name === "TypeError") {
        paintMessage("This OpenChamber build does not support reading the todo file.");
        stop();
        return;
      }
      if (setupNote) {
        paintSetupNote(setupNote);
        return;
      }
      paintMessage(code === "NOT_FOUND" ? "No todos for this session." : "Could not read todos.");
      return;
    }
    if (!isCurrent())
      return;
    const doc = parseDoc(content);
    if (doc === null) {
      paintMessage("Todo list is not valid JSON.");
      return;
    }
    const key = JSON.stringify([requestedSessionID, doc.todos, doc.phases, openFinished]);
    if (key === lastKey)
      return;
    lastKey = key;
    paint(doc.todos, doc.phases);
  }
  function start() {
    if (timer !== null)
      return;
    timer = setInterval(() => {
      refresh();
    }, POLL_MS);
  }
  function stop() {
    refreshSequence += 1;
    if (timer === null)
      return;
    clearInterval(timer);
    timer = null;
  }
  function insideHostFrame() {
    try {
      return window.parent !== window;
    } catch {
      return true;
    }
  }
  function boot() {
    ensureGutStyle(document);
    if (!insideHostFrame()) {
      paintMessage("Open this inside OpenChamber to see todos.");
      return;
    }
    const watchdog = setTimeout(() => {
      if (booted)
        return;
      paintMessage("Connecting to OpenChamber…");
    }, BOOT_WATCHDOG_MS);
    try {
      host = connectHost({ requestTimeoutMs: REQUEST_TIMEOUT_MS });
    } catch (error) {
      clearTimeout(watchdog);
      paintMessage(error && error.code === "HOST_UNAVAILABLE" ? "Open this inside OpenChamber to see todos." : "Could not connect to OpenChamber.");
      return;
    }
    wireInput();
    host.onReady((ctx) => {
      if (!booted) {
        booted = true;
        clearTimeout(watchdog);
      }
      applyHostReady(ctx, document.documentElement);
      const next = ctx && ctx.session && typeof ctx.session.id === "string" ? ctx.session.id : null;
      if (next !== sessionID) {
        cancelRowAnimations();
        sessionID = next;
        lastKey = "";
        openFinished = false;
        finishedFor = null;
        observedTaskSession = null;
        previousTaskKeys.clear();
        pendingTypewriterKeys.clear();
        completedAtEnd.clear();
        completionSequence = 0;
        paintedPhases = [];
        suppressAnimationsForNextPaint = true;
      }
      if (!installChecked && !UI_ONLY) {
        installChecked = true;
        ensureInstalled(host).then((outcome) => {
          if (outcome.ok && outcome.reason === "current")
            return;
          const failed = !outcome.ok || String(outcome.reason).startsWith("write-failed");
          setupNote = failed ? "write-failed" : outcome.reason;
          lastKey = "";
        }).catch(() => {
          setupNote = "write-failed";
          lastKey = "";
        }).finally(() => {
          refresh();
          start();
        });
        return;
      }
      refresh();
      start();
    });
    host.onSession((session) => {
      const next = session && typeof session.id === "string" ? session.id : null;
      if (next !== sessionID) {
        cancelRowAnimations();
        sessionID = next;
        openFinished = false;
        finishedFor = null;
        observedTaskSession = null;
        previousTaskKeys.clear();
        pendingTypewriterKeys.clear();
        completedAtEnd.clear();
        completionSequence = 0;
        paintedPhases = [];
        suppressAnimationsForNextPaint = true;
      }
      lastKey = "";
      refresh();
    });
  }
  boot();
})();
