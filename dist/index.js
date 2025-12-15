import { Logger, ConnectorService, AgentSettings, AccessCandidate, AgentProcess, Conversation } from '@smythos/sdk/core';
import cors from 'cors';
import multer from 'multer';
import axios from 'axios';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import crypto from 'crypto';
import { Readable } from 'stream';
import { faker } from '@faker-js/faker';
import Joi from 'joi';
import { OpenAI } from 'openai';
import Converter from 'openapi-to-postmanv2';
import swaggerUi from 'swagger-ui-express';

var version = "1.0.1";

var __defProp$2 = Object.defineProperty;
var __defNormalProp$2 = (obj, key, value) => key in obj ? __defProp$2(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField$2 = (obj, key, value) => __defNormalProp$2(obj, typeof key !== "symbol" ? key + "" : key, value);
class ApiError extends Error {
  /**
   *
   * @param statusCode - http status code of the error
   * @param message - error message
   * @param isOperational - whether the error should be shown in production or not (if not, internal server error will be shown)
   * @param stack - error stack trace
   * @param errKey -  error code to be used in the response
   */
  constructor(statusCode, message, errKey, isOperational = true, stack) {
    super(message);
    __publicField$2(this, "statusCode");
    __publicField$2(this, "isOperational");
    __publicField$2(this, "stack");
    __publicField$2(this, "errKey");
    __publicField$2(this, "isApiError");
    this.statusCode = statusCode;
    this.isOperational = isOperational === void 0 ? true : isOperational;
    this.errKey = errKey;
    this.isApiError = true;
  }
}

const DEFAULT_AGENT_MODEL_SETTINGS_KEY = "chatGptModel";
const DEFAULT_AGENT_MODEL = "gpt-4o-mini";

const console$7 = Logger("AgentLoader.mw");
async function AgentLoader(req, res, next) {
  console$7.log("AgentLoader", req.path);
  const agentDataConnector = ConnectorService.getAgentDataConnector();
  let agentId = req.header("X-AGENT-ID");
  const agentVersion = req.header("X-AGENT-VERSION") || "";
  const debugHeader = req.header("X-DEBUG-STOP") !== void 0 || req.header("X-DEBUG-RUN") !== void 0 || req.header("X-DEBUG-INJ") !== void 0 || req.header("X-DEBUG-READ") !== void 0;
  let agentDomain = "";
  let isTestDomain = false;
  const { path, version: extractedVersion } = extractAgentVerionsAndPath(req.path);
  let version = extractedVersion ?? agentVersion;
  const domain = req.hostname;
  req.method;
  if (!agentId) {
    agentId = await agentDataConnector.getAgentIdByDomain(domain).catch((error) => {
      console$7.error(error);
    });
    agentDomain = domain;
  }
  if (agentId && domain.includes(process.env.AGENT_DOMAIN)) {
    isTestDomain = true;
  }
  if (agentId) {
    if (!isTestDomain && agentId && req.hostname.includes("localhost")) {
      console$7.log(`Agent is running on localhost (${req.hostname}), assuming test domain`);
      isTestDomain = true;
    }
    if (agentDomain && !isTestDomain && !version && !debugHeader) {
      version = "latest";
    }
    const agentData = await agentDataConnector.getAgentData(agentId, version).catch((error) => {
      console$7.warn("Failed to load agent data", {
        agentId,
        version,
        errorMessage: error?.message
      });
      return { error: error.message };
    });
    if (agentData?.error) {
      if (req.path.startsWith("/storage/")) {
        return res.status(404).send(`File Not Found`);
      }
      return res.status(500).send({ error: agentData.error });
    }
    cleanAgentData(agentData);
    req._plan = agentData.data.planInfo;
    req._agentData = agentData.data;
    req._agentData.planInfo = req._plan || {
      planId: void 0,
      planName: void 0,
      isFreePlan: true,
      tasksQuota: 0,
      usedTasks: 0,
      remainingTasks: 0,
      maxLatency: 100
    };
    if (!isTestDomain && req._agentData.debugSessionEnabled && debugHeader) {
      console$7.log(`Host ${req.hostname} is using debug session. Assuming test domain.#2`);
      isTestDomain = true;
    }
    req._agentData.usingTestDomain = isTestDomain;
    req._agentData.domain = agentDomain || agentData?.data?.metadata?.domains?.[0]?.name || await getAgentDomainById(agentId);
    req._agentVersion = version;
    req._agentData.version = version;
    const agentSettings = new AgentSettings(agentId);
    req._agentSettings = agentSettings;
    console$7.log(`Loaded Agent:${agentId} v=${version} path=${path} isTestDomain=${isTestDomain} domain=${agentDomain}`);
    return next();
  }
  console$7.warn("Not found", { path: req.path });
  return res.status(404).send({ error: `${req.path} Not Found` });
}
function cleanAgentData(agentData) {
  if (agentData) {
    if (agentData.data.components) {
      agentData.data.components = agentData.data.components?.filter((c) => c.name != "Note");
    }
    delete agentData.data?.templateInfo;
  }
  return agentData;
}
function extractAgentVerionsAndPath(url) {
  const regex = /^\/v(\d+(\.\d+)?)?(\/api\/.+)/;
  const match = url.match(regex);
  if (match) {
    return {
      path: match[3],
      version: match[1] || ""
    };
  } else {
    return {
      path: url,
      version: ""
    };
  }
}
async function getAgentDomainById(agentId) {
  const agentDataConnector = ConnectorService.getAgentDataConnector();
  const deployed = await agentDataConnector.isDeployed(agentId);
  if (deployed) {
    return `${agentId}.${process.env.PROD_AGENT_DOMAIN}`;
  } else {
    return `${agentId}.${process.env.AGENT_DOMAIN}`;
  }
}

const console$6 = Logger("CORS.mw");
async function getEmbodimentsAllowedOrigins(agentSettings) {
  await agentSettings?.embodiments?.ready();
  const embSettings = agentSettings?.embodiments?.getAll() ?? {};
  const agentAllowedOrigins = Object.values(embSettings).flatMap((embodiment) => embodiment.allowedDomains).flat(Infinity).map((domain) => {
    if (domain?.startsWith("http")) {
      return new URL(domain)?.origin;
    }
    return `https://${domain}`;
  });
  return agentAllowedOrigins;
}
function checkCors(req, allowedOrigins, allowedDomains) {
  const origin = req.get("Origin");
  if (!origin) return true;
  const host = req.get("Host");
  const originDomain = new URL(origin).hostname;
  console$6.log("Cors check ", origin, "==>", host);
  const isSameOrigin = origin === `http://${host}` || origin === `https://${host}`;
  if (isSameOrigin) return true;
  if (allowedOrigins.includes(origin)) return true;
  if (allowedDomains.includes(originDomain)) return true;
  if (req.method == "OPTIONS") {
    console$6.log("CORS check ", { path: req.path, host, origin }, "==> Denied ");
    console$6.log("Allowed Domains for this request ", allowedOrigins, allowedDomains);
  }
  return false;
}
const corsOptionsDelegate = async (req, callback) => {
  const allowedEmbOrigins = await getEmbodimentsAllowedOrigins(req._agentSettings);
  const isAllowed = checkCors(req, allowedEmbOrigins, []);
  let corsOptions;
  if (isAllowed) {
    corsOptions = {
      origin: true,
      credentials: true,
      // Allow credentials (cookies, etc.)
      methods: ["GET", "POST", "PUT", "DELETE"],
      // Allowed methods
      allowedHeaders: ["Content-Type", "Authorization", "X-Conversation-Id", "X-Auth-Token", "X-Parent-Cookie"]
    };
  } else {
    corsOptions = { origin: false };
  }
  callback(null, corsOptions);
};
const middleware = cors(corsOptionsDelegate);

function RemoveHeadersFactory(headers) {
  return (req, res, next) => {
    headers.forEach((header) => {
      if (req.headers[header]) {
        delete req.headers[header];
      }
    });
    return next();
  };
}

const console$5 = Logger("UploadHandlerFactory.mw");
const MAX_FILE_SIZE = 1024 * 1024 * 20;
const MAX_FILE_COUNT = 5;
function uploadHandlerFactory(maxFileSize = MAX_FILE_SIZE, maxFileCount = MAX_FILE_COUNT) {
  const upload = multer({
    limits: { fileSize: maxFileSize },
    storage: multer.memoryStorage()
  });
  function uploadHandler(req, res, next) {
    upload.any()(req, res, (err) => {
      if (err) {
        console$5.warn(`File upload error: ${err.message}`);
        return next(new Error(`File upload error: ${err.message}`));
      }
      if (req.files && req.files.length > maxFileCount) {
        console$5.warn(`Too many files: ${req.files.length}`);
        return res.status(400).send("Too many files");
      }
      next();
    });
  }
  return uploadHandler;
}

class BaseRole {
  /**
   * Creates a new Role instance.
   * @param router - The router to mount the role on.
   * @param middlewares - The custom middlewares to apply to the role on top of the default middlewares.
   */
  constructor(middlewares, options) {
    this.middlewares = middlewares;
    this.options = options;
  }
  /**
   * Resolves a value that can be either static or dynamically computed via a function.
   * This generic method implements the DRY principle for value-or-function resolution patterns.
   *
   * @template T - The type of the resolved value
   * @template Args - The argument object type for the resolver function
   *
   * @param resolvable - Either a static value of type T or a function that returns T
   * @param args - Optional argument object to pass to the resolver function (required only if resolvable is a function)
   * @param defaultValue - Optional default value to use if resolvable is undefined or returns undefined
   * @returns The resolved value of type T, or defaultValue, or undefined
   *
   * @example
   * -- Resolve static value with default
   * const timeout = this.resolve(this.options.timeout, undefined, 5000);
   *
   * @example
   * -- Resolve dynamic value without default (returns string | undefined)
   * const origin = this.resolve(this.options.serverOrigin, req);
   *
   * @example
   * -- Resolve model with default fallback (always returns string)
   * const model = this.resolve(
   *     this.options.model,
   *     { baseModel, planInfo: agentData?.planInfo || {} },
   *     baseModel
   * );
   */
  resolve(resolvable, args, defaultValue) {
    if (resolvable === void 0) {
      return defaultValue;
    }
    const resolved = typeof resolvable === "function" ? resolvable(args) : resolvable;
    return resolved !== void 0 ? resolved : defaultValue;
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async mount(router) {
  }
}

const PROD_VERSION_VALUES = ["prod", "production", "stable"];
const TEST_VERSION_VALUES = ["dev", "develop", "development", "test", "staging"];
function getAgentIdAndVersion(model) {
  const [agentId, version] = model.split("@");
  let agentVersion = version?.trim() || void 0;
  if (TEST_VERSION_VALUES.includes(agentVersion)) {
    agentVersion = "";
  }
  if (PROD_VERSION_VALUES.includes(agentVersion)) {
    agentVersion = "latest";
  }
  return { agentId, agentVersion };
}

const console$4 = Logger("AgentRequestHandler");
const debugPromises = {};
const sseConnections = /* @__PURE__ */ new Map();
const MOCK_DATA = {
  SETTINGS_KEY: "agent-mock-data"
};
async function getMockData(agentId) {
  const accountConnector = ConnectorService.getAccountConnector();
  const mockData = await accountConnector.user(AccessCandidate.agent(agentId)).getAgentSetting(MOCK_DATA.SETTINGS_KEY);
  return JSON.parse(mockData || "{}");
}
function getDebugSession(id) {
  console$4.log(`Getting debug session for agent ${id} with session id ${debugPromises[id]?.dbgSession}`);
  console$4.log(`Session exists: ${debugPromises[id] ? "Yes" : "No"} and session.dbgSession exists: ${debugPromises[id]?.dbgSession ? "Yes" : "No"}`);
  console$4.log(`Debug sessions found for the following agents: ${Object.keys(debugPromises).join(", ")}`);
  return debugPromises[id]?.dbgSession;
}
function createSseConnection(req) {
  const sseId = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  const INACTIVITY_TIMEOUT = 60 * 60 * 1e3;
  const res = req.res;
  const connection = { res, timeout: null };
  sseConnections.set(sseId, connection);
  console$4.log(`Created SSE connection for ${sseId}`);
  const originalWrite = res.write;
  res.write = function(...args) {
    clearTimeout(connection.timeout);
    connection.timeout = setTimeout(() => {
      console$4.log(`Client disconnected: ${sseId}`);
      sseConnections.delete(sseId);
      res.end();
    }, INACTIVITY_TIMEOUT);
    return originalWrite.apply(res, args);
  };
  req.on("close", () => {
    console$4.log(`Client disconnected: ${sseId}`);
    sseConnections.delete(sseId);
    res.end();
  });
  return sseId;
}
function handleMonitorIds(req, agentProcess) {
  const monitorIds = req.header("X-MONITOR-ID") ? new Set(
    req.header("X-MONITOR-ID").split(",").map((id) => id.trim())
  ) : void 0;
  if (monitorIds) {
    for (const monitorId of monitorIds) {
      if (sseConnections.has(monitorId)) {
        const connection = sseConnections.get(monitorId);
        agentProcess.agent.addSSE(connection.res, monitorId);
      }
    }
  }
}
async function readAgentState(req, agentProcess, readStateId) {
  try {
    const result = await agentProcess.readDebugState(readStateId, {
      ...req,
      path: req.url,
      url: void 0,
      headers: {
        ...req.headers
      }
    });
    return { status: 200, data: result };
  } catch (error) {
    console$4.error(error);
    return { status: 400, data: "Agent State Unavailable" };
  }
}
async function handleMockData(req, agentProcess) {
  const agentData = req?._agentData;
  const agentId = agentData?.id;
  let body = [];
  try {
    const mockData = await getMockData(agentId);
    for (const [key, value] of Object.entries(mockData)) {
      let output = {};
      if (value && Object.keys(value).length > 0) {
        output = value?.data?.outputs;
      }
      if (output && Object.keys(output).length > 0) {
        body.push({
          id: key,
          ctx: {
            active: false,
            output
          }
        });
      }
    }
  } catch (error) {
    console$4.warn("Error getting mock data", error);
  }
  if (body?.length > 0) {
    req.headers["x-mock-data-inj"] = "";
  }
  const existingBody = Object.keys(req.body).length === 0 ? [] : req.body;
  if (Array.isArray(existingBody)) {
    const existingComponentIds = existingBody?.map((item) => item.id) || [];
    body = body.filter((item) => !existingComponentIds.includes(item.id));
    req.body = [...existingBody, ...body];
  }
}
async function processAgentRequest(req, reqOverride) {
  const agentData = req._agentData;
  const agentId = agentData?.id;
  if (!agentData) {
    return { status: 404, data: "Agent not found" };
  }
  const agentProcess = AgentProcess.load(agentData);
  if (!agentProcess) {
    return { status: 404, data: "Agent not found" };
  }
  await agentProcess.ready();
  const usingTestDomain = agentData.usingTestDomain;
  const debugSessionEnabled = agentData.debugSessionEnabled;
  const hasDebugHeaders = Object.keys(req.headers).some((key) => key.toLowerCase().startsWith("x-debug-"));
  if (usingTestDomain) handleMonitorIds(req, agentProcess);
  let startLiveDebug = usingTestDomain && debugSessionEnabled && typeof req.header("X-DEBUG-SKIP") == "undefined" && typeof req.header("X-DEBUG-RUN") == "undefined" && typeof req.header("X-DEBUG-read") == "undefined" && typeof req.header("X-DEBUG-INJ") == "undefined" && typeof req.header("X-DEBUG-STOP") == "undefined";
  if (hasDebugHeaders || startLiveDebug) {
    const readStateId = req.header("X-DEBUG-READ") || "";
    if (readStateId) {
      return await readAgentState(req, agentProcess, readStateId);
    }
    await handleMockData(req);
  }
  let result;
  if (startLiveDebug) {
    result = await runAgentDebug(agentId, agentProcess, req);
  } else {
    result = await runAgentProcess(agentId, agentProcess, req);
  }
  if (hasDebugHeaders || startLiveDebug) {
    const { includeNewState } = req.query || {};
    if (includeNewState) {
      const readStateId = result?.data?.dbgSession;
      if (readStateId) {
        const newState = await readAgentState(req, agentProcess, readStateId);
        result.data.newState = result.status === 200 ? newState.data : null;
      }
    }
  }
  return result;
}
async function runAgentProcess(agentId, agentProcess, req) {
  try {
    const debugPromiseId = `${agentId}`;
    if (req.header("X-DEBUG-STOP")) {
      if (debugPromises[debugPromiseId]) {
        console$4.log(
          `Debug session for agent ${agentId} with session id ${debugPromiseId} stopped because of X-DEBUG-STOP header. DELETING PROMISE`
        );
        const dbgPromise2 = debugPromises[debugPromiseId];
        delete debugPromises[debugPromiseId];
        dbgPromise2.resolve({ status: 400, error: "Debug Session Stopped" });
      }
    }
    let dbgPromise = debugPromises[debugPromiseId];
    if (dbgPromise?.sse) {
      agentProcess.agent.addSSE(dbgPromise.sse);
    }
    const pathMatches = req.path.match(/(^\/v[0-9]+\.[0-9]+?)?(\/(api|trigger)\/(.+)?)/);
    if (!pathMatches || !pathMatches[2]) {
      return { status: 404, data: { error: "Endpoint not found" } };
    }
    const { data: result } = await agentProcess.run({
      ...req,
      path: req.path,
      url: void 0,
      headers: {
        ...req.headers
        //'X-DEBUG-RUN': '',
      }
    }).catch((error) => ({ data: { error: error.toString() } }));
    if (result?.error) {
      if (result.error !== "AGENT_KILLED") console$4.error("ERROR", result.error);
      return {
        status: 500,
        data: {
          ...result,
          error: result.error.toString(),
          agentId,
          // agentName: agent?.name
          agentName: void 0
        }
      };
    }
    const dbgSession = result?.dbgSession || result?.expiredDbgSession || "";
    dbgPromise = debugPromises[debugPromiseId];
    if (dbgSession && dbgPromise) {
      if (result.finalResult) {
        console$4.log(
          `Debug session for agent ${agentId} with session id ${debugPromiseId} resolved since the final result is available. DELETING PROMISE`
        );
        delete debugPromises[debugPromiseId];
        dbgPromise.resolve(result.finalResult);
      }
    }
    return { status: 200, data: result };
  } catch (error) {
    console$4.error(error);
    if (error.response) {
      return { status: error.response.status, data: error.response.data };
    } else {
      return { status: 500, data: "Internal Server Error" };
    }
  }
}
async function runAgentDebug(agentId, agentProcess, req) {
  try {
    const debugPromiseId = `${agentId}`;
    const excludedHeaders = ["host", "content-length", "accept-encoding"];
    const headers = Object.keys(req.headers).filter((header) => !excludedHeaders.includes(header.toLowerCase())).reduce((obj, header) => {
      obj[header] = req.headers[header];
      return obj;
    }, {});
    headers["X-AGENT-ID"] = agentId;
    headers["X-DEBUG-RUN"] = "";
    const port = process.env.PORT || 3e3;
    let url = `http://localhost:${port}${req.path.replace("/debug", "/api")}`;
    const input = req.method == "GET" ? req.query : req.body;
    let apiResponse;
    if (req.files) {
      const formData = new FormData();
      for (let file of req.files) {
        const fieldname = file.fieldname;
        const blob = new Blob([file.buffer], { type: file.mimetype });
        formData.append(fieldname, blob, file.originalname);
      }
      for (let entry in req.body) {
        formData.append(entry, req.body[entry]);
      }
      apiResponse = await axios({
        method: req.method,
        url,
        data: formData,
        headers,
        params: req.query
      });
    } else {
      apiResponse = await axios({
        method: req.method,
        url,
        data: req.body,
        headers,
        params: req.query
      });
    }
    const dbgSession = apiResponse?.data?.dbgSession;
    if (dbgSession) {
      if (debugPromises[debugPromiseId]) {
        console$4.log(
          `Tried to start a new debug session for agent ${agentId}, but a session is already running. req path ${req.path} and url ${req.url}. DELETING THE OLD PROMISE TO START A NEW ONE`
        );
        agentProcess?.agent?.sse?.close();
        const dbgPromise = debugPromises[debugPromiseId];
        dbgPromise.reject({
          status: 400,
          data: { error: "Debug session interrupted by another request", details: { debugPromiseId, session: dbgPromise.dbgSession } }
        });
        delete debugPromises[debugPromiseId];
      }
      const sessionPromise = new Promise((resolve, reject) => {
        console$4.log(
          `A new debug session is started for agent ${agentId} with session id ${dbgSession} and req path ${req.path} and url${req.url}. CLIENT IP: ${req.headers["x-forwarded-for"]} - ${req?.socket?.remoteAddress}. X-HASH-ID: ${req.headers["x-hash-id"]}`
        );
        debugPromises[debugPromiseId] = { dbgSession, resolve, reject, sse: agentProcess.agent.sse };
        setTimeout(
          () => {
            console$4.log(`Debug session for agent ${agentId} with session id ${dbgSession} expired. DELETING PROMISE`);
            delete debugPromises[debugPromiseId];
            reject({ status: 500, data: "Debug Session Expired" });
          },
          60 * 60 * 1e3
          // 1 hour
        );
      });
      const finalResult = await sessionPromise.catch((error) => ({
        error
      }));
      agentProcess?.agent?.sse?.close();
      if (finalResult?.error) {
        return {
          status: finalResult.status || 500,
          data: { error: finalResult.error }
        };
      }
      let data = finalResult;
      return { status: 200, data };
    }
  } catch (error) {
    if (error.response) {
      console$4.error(error.response.status, error.response.data);
      return { status: error.response.status, data: error.response.data };
    } else {
      console$4.error(error);
      return { status: 500, data: "Internal Server Error" };
    }
  }
}
process.on("MANAGEMENT:DISABLE_PORT", async () => {
  console$4.log("Closing all SSE connections");
  sseConnections.forEach((connection) => {
    connection.res.end();
  });
  sseConnections.clear();
});

var __defProp$1 = Object.defineProperty;
var __defNormalProp$1 = (obj, key, value) => key in obj ? __defProp$1(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField$1 = (obj, key, value) => __defNormalProp$1(obj, typeof key !== "symbol" ? key + "" : key, value);
const console$3 = Logger("AgentRole");
class AgentRole {
  constructor(middlewares, options) {
    this.middlewares = middlewares;
    __publicField$1(this, "maxFileSize");
    __publicField$1(this, "maxFileCount");
    __publicField$1(this, "enableDebugger");
    __publicField$1(this, "enableTriggers");
    __publicField$1(this, "enableMonitor");
    this.maxFileSize = options.maxUploadSize || 1024 * 1024 * 10;
    this.maxFileCount = options.maxUploadsCount || 5;
    this.enableDebugger = options.enableDebugger || false;
    this.enableMonitor = options.enableMonitor || false;
    this.enableTriggers = options.enableTriggers || false;
  }
  async mount(router) {
    const uploadHandler = uploadHandlerFactory(this.maxFileSize, this.maxFileCount);
    const middlewares = [middleware, uploadHandler, AgentLoader, ...this.middlewares];
    if (!this.enableDebugger) {
      const removeDebugHeaders = RemoveHeadersFactory(["x-debug-skip", "x-debug-run", "x-debug-inj", "x-debug-read"]);
      middlewares.unshift(removeDebugHeaders);
    }
    if (!this.enableMonitor) {
      const removeMonitorHeaders = RemoveHeadersFactory(["x-monitor-id"]);
      middlewares.unshift(removeMonitorHeaders);
    }
    router.options("*", [middleware]);
    if (this.enableDebugger) {
      router.get("/agent/:id/debugSession", [middleware], (req, res, next) => {
        console$3.log(
          `Getting debug session for agent ${req.params.id} with client IP ${req.headers["x-forwarded-for"]} - ${req.socket.remoteAddress}. x-hash-id ${req.headers["x-hash-id"]}`
        );
        const dbgSession = getDebugSession(req.params.id);
        res.send({ dbgSession });
      });
    }
    if (this.enableMonitor) {
      router.get("/agent/:id/monitor", [middleware], (req, res, next) => {
        const sseId = createSseConnection(req);
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.write(`event: init
`);
        res.write(`data: ${sseId}

`);
      });
    }
    const reqHandler = async (req, res) => {
      try {
        const agentData = req._agentData;
        if (!agentData) {
          res.status(404).json({ error: "Agent not found" });
          return;
        }
        const result = await processAgentRequest(req);
        if (!res.headersSent) {
          res.status(result?.status || 500).send(result?.data);
        }
      } catch (error) {
        res.status(500).json({ error: error.message || "Internal server error" });
      }
    };
    if (this.enableTriggers) {
      router.post(`/trigger/:name`, middlewares, reqHandler);
      router.get(`/trigger/:name`, middlewares, reqHandler);
    }
    router.post(`/api/*`, middlewares, reqHandler);
    router.get(`/api/*`, middlewares, reqHandler);
    router.post(`/:version/api/*`, middlewares, reqHandler);
    router.get(`/:version/api/*`, middlewares, reqHandler);
    router.post(/^\/v[0-9]+(\.[0-9]+)?\/api\/(.+)/, middlewares, reqHandler);
    router.get(/^\/v[0-9]+(\.[0-9]+)?\/api\/(.+)/, middlewares, reqHandler);
  }
}

const SPEAKABLE_FORMAT_PROMPT = "Return the response in speakable format";
const ALEXA_BASE_URL = "https://api.amazonalexa.com";
const ALEXA_SETTINGS_KEY = "alexa";
async function handleAlexaRequest({
  isEnabled,
  model,
  alexRequest,
  agentData,
  serverOrigin
}) {
  if (!isEnabled) {
    return buildAlexaResponse("Alexa is not enabled for this agent");
  }
  if (alexRequest.type === "LaunchRequest") {
    return buildAlexaResponse("Hi I am smythos agent. What can I help you with?");
  }
  const query = alexRequest.slots.searchQuery.heardAs;
  const agentResponse = await processAlexaSearchQuery({ query, model, agentData, serverOrigin });
  const response = buildAlexaResponse(agentResponse);
  return response;
}
function parseAlexaRequest(alexRequest) {
  const type = alexRequest.request.type;
  const intent = alexRequest.request.intent;
  const slots = intent?.slots ? getSlotValues(intent.slots) : {};
  return { type, intent, slots };
}
function getSlotValues(filledSlots) {
  const slotValues = {};
  Object.keys(filledSlots).forEach((item) => {
    const name = filledSlots[item].name;
    if (filledSlots[item] && filledSlots[item].resolutions && filledSlots[item].resolutions.resolutionsPerAuthority[0] && filledSlots[item].resolutions.resolutionsPerAuthority[0].status && filledSlots[item].resolutions.resolutionsPerAuthority[0].status.code) {
      switch (filledSlots[item].resolutions.resolutionsPerAuthority[0].status.code) {
        case "ER_SUCCESS_MATCH":
          slotValues[name] = {
            heardAs: filledSlots[item].value,
            resolved: filledSlots[item].resolutions.resolutionsPerAuthority[0].values[0].value.name,
            ERstatus: "ER_SUCCESS_MATCH"
          };
          break;
        case "ER_SUCCESS_NO_MATCH":
          slotValues[name] = {
            heardAs: filledSlots[item].value,
            resolved: "",
            ERstatus: "ER_SUCCESS_NO_MATCH"
          };
          break;
      }
    } else {
      slotValues[name] = {
        heardAs: filledSlots[item].value || "",
        // may be null
        resolved: "",
        ERstatus: ""
      };
    }
  }, this);
  return slotValues;
}
function buildAlexaResponse(outputSpeech, reprompt = "", shouldEndSession = false) {
  return {
    version: "1.0",
    sessionAttributes: {},
    response: {
      outputSpeech: {
        type: "PlainText",
        text: outputSpeech
      },
      reprompt: {
        outputSpeech: {
          type: "PlainText",
          text: reprompt
        }
      },
      shouldEndSession
    }
  };
}
async function createAlexaSkill(agentName, accessToken, vendorId, endpoint) {
  try {
    const response = await axios({
      method: "post",
      url: `${ALEXA_BASE_URL}/v1/skills`,
      headers: {
        Authorization: "Bearer " + accessToken,
        "Content-Type": "application/json"
      },
      data: {
        vendorId,
        manifest: {
          apis: {
            custom: {
              endpoint: {
                sslCertificateType: "Wildcard",
                uri: endpoint
              },
              interfaces: [],
              locales: {}
            }
          },
          manifestVersion: "1.0",
          publishingInformation: {
            category: "ORGANIZERS_AND_ASSISTANTS",
            locales: {
              "en-US": {
                description: "Smythos agent",
                examplePhrases: ["Alexa open " + agentName],
                keywords: [agentName],
                name: agentName,
                summary: "invoke " + agentName
              }
            }
          }
        }
      }
    });
    const skillId = response.data.skillId;
    await new Promise((resolve) => setTimeout(resolve, 2e3));
    await axios({
      method: "put",
      url: `${ALEXA_BASE_URL}/v1/skills/${skillId}/stages/development/interactionModel/locales/en-US`,
      headers: {
        Authorization: "Bearer " + accessToken,
        "Content-Type": "application/json"
      },
      data: {
        interactionModel: {
          languageModel: {
            invocationName: agentName.toLowerCase(),
            intents: [
              {
                name: "AMAZON.CancelIntent",
                samples: []
              },
              {
                name: "AMAZON.HelpIntent",
                samples: []
              },
              {
                name: "AMAZON.StopIntent",
                samples: []
              },
              {
                name: "AMAZON.FallbackIntent",
                samples: []
              },
              {
                name: "AMAZON.NavigateHomeIntent",
                samples: []
              },
              {
                name: "SmythosQuery",
                slots: [
                  {
                    name: "searchQuery",
                    type: "AMAZON.SearchQuery"
                  }
                ],
                samples: ["Hi {searchQuery}", "Hello {searchQuery}"]
              }
            ],
            types: []
          }
        }
      }
    });
    return skillId;
  } catch (error) {
    console.error(error?.response?.data);
  }
}
function processAlexaSearchQuery({
  query,
  model,
  agentData,
  serverOrigin
}) {
  return new Promise((resolve, reject) => {
    let result = "";
    const agentDataConnector = ConnectorService.getAgentDataConnector();
    agentDataConnector.getOpenAPIJSON(agentData, serverOrigin, agentData.usingTestDomain ? "" : "latest", true).then((spec) => {
      const conversation = new Conversation(model, spec, {
        agentId: agentData.id
      });
      conversation.on("error", (error) => {
        console.error("Error in conversation:", error);
        reject(new Error("An error occurred. Please try again later or select a different model."));
      });
      conversation.on("content", (content) => {
        if (content?.indexOf("}{") >= 0) {
          content = content.replace(/}{/g, "} {");
        }
        result += content;
      });
      conversation.on("end", () => {
        console.log("streaming: [DONE]");
        resolve(result);
      });
      conversation.streamPrompt(`${query} ${SPEAKABLE_FORMAT_PROMPT}`, {
        "X-AGENT-ID": agentData.id
      });
    }).catch((error) => {
      reject(error);
    });
  });
}
function isAlexaEnabled(agentData, agentSettings) {
  if (agentData.usingTestDomain) {
    return true;
  }
  return agentSettings?.get(ALEXA_SETTINGS_KEY) === "true";
}

class AlexaRole extends BaseRole {
  /**
   * Creates a new AlexaRole instance.
   * @param middlewares - The custom middlewares to apply to the role on top of the default middlewares.
   * @param options - The options for the role
   * @param options.serverOrigin - Server origin URL: string for static, or function to resolve dynamically from request
   * @param options.model - Optional model override: string for static model, or function to resolve model dynamically
   */
  constructor(middlewares = [], options) {
    super(middlewares, options);
  }
  async mount(router) {
    const middlewares = [AgentLoader, ...this.middlewares];
    router.post("/", middlewares, async (req, res) => {
      try {
        const agentData = req._agentData;
        const agentSettings = req._agentSettings;
        await agentSettings?.ready();
        const isEnabled = isAlexaEnabled(agentData, agentSettings);
        await agentSettings?.embodiments?.ready();
        const serverOrigin = this.resolve(this.options.serverOrigin, req);
        const alexRequest = parseAlexaRequest(req.body);
        const baseModel = agentSettings?.get(DEFAULT_AGENT_MODEL_SETTINGS_KEY) || DEFAULT_AGENT_MODEL;
        const model = this.resolve(this.options?.model, { baseModel, planInfo: agentData?.planInfo || {} }, baseModel);
        const response = await handleAlexaRequest({
          isEnabled,
          model,
          alexRequest,
          agentData,
          serverOrigin
        });
        res.json(response);
      } catch (error) {
        console.error(error);
        return res.status(500).send({ error: error.message });
      }
    });
    router.post("/publish", middlewares, async (req, res) => {
      try {
        const agentData = req._agentData;
        const agentName = agentData.name;
        const agentDomain = agentData.domain;
        const accessToken = req.body.accessToken;
        const vendorId = req.body.vendorId;
        const scheme = agentDomain.includes(":") ? "http" : "https";
        const endpoint = `${scheme}://${agentDomain}/alexa`;
        await createAlexaSkill(agentName, accessToken, vendorId, endpoint);
        return res.json({ success: true, message: "Agent published to Alexa successfully" });
      } catch (error) {
        console.error("Error publishing to Alexa:", error);
        return res.status(500).json({ success: false, error: error.message });
      }
    });
  }
}

class ChatGPTRole extends BaseRole {
  /**
   * Creates a new ChatGPTRole instance.
   *
   * This role provides ChatGPT-compatible OpenAPI specifications for SmythOS agents.
   * It transforms the standard OpenAPI 3.0.1 spec to 3.1.0 format required by ChatGPT Actions,
   * and handles GPT-specific limitations (e.g., 300 character summary limits).
   *
   * @param middlewares - Custom middlewares to apply on top of default middlewares
   * @param options - Configuration options for the role
   * @param options.serverOrigin - Server origin URL (string or function that returns string from request)
   *                                Used for generating absolute URLs in the OpenAPI spec
   */
  constructor(middlewares, options) {
    super(middlewares, options);
  }
  /**
   * Mounts the ChatGPT role routes on the provided router.
   *
   * Registers a GET endpoint at `/api-docs/openapi-gpt.json` that serves
   * a ChatGPT-compatible OpenAPI 3.1.0 specification for the agent.
   *
   * @param router - Express router to mount the routes on
   */
  async mount(router) {
    const middlewares = [AgentLoader, ...this.middlewares];
    router.get("/api-docs/openapi-gpt.json", middlewares, async (req, res) => {
      const agentData = req._agentData;
      const serverOrigin = this.resolve(this.options.serverOrigin, req);
      const agentDataConnector = ConnectorService.getAgentDataConnector();
      const openAPIObj = await agentDataConnector.getOpenAPIJSON(agentData, serverOrigin, agentData.version, false);
      if (openAPIObj?.error) {
        return res.status(500).send({ error: openAPIObj.error });
      }
      const transformedSpec = transformOpenAPI301to310(openAPIObj);
      if ("paths" in transformedSpec) {
        for (const path in transformedSpec.paths) {
          const entry = transformedSpec.paths[path];
          for (const method in entry) {
            if (!entry[method].summary) continue;
            entry[method].summary = splitOnSeparator(entry[method].summary, 300, ".");
          }
        }
      }
      res.setHeader("Content-Type", "application/json");
      res.send(JSON.stringify(transformedSpec, null, 2));
    });
  }
}
function transformOpenAPI301to310(spec) {
  const transformed = JSON.parse(JSON.stringify(spec));
  transformed.openapi = "3.1.0";
  function transformSchema(schema) {
    if (!schema || typeof schema !== "object") return schema;
    if (schema.type === "array") {
      if (!schema.items || Object.keys(schema.items).length === 0) {
        schema.items = { type: "string" };
      } else {
        schema.items = transformSchema(schema.items);
      }
    }
    if (schema.type === "object") {
      if (schema.additionalProperties !== void 0 && typeof schema.additionalProperties === "object" && Object.keys(schema.additionalProperties).length === 0) {
        schema.additionalProperties = true;
      }
      if (schema.properties) {
        for (const [key, prop] of Object.entries(schema.properties)) {
          schema.properties[key] = transformSchema(prop);
        }
      }
    }
    if (schema.format === "binary") {
      delete schema.format;
      schema.type = "string";
      schema.contentEncoding = "base64";
    }
    if (schema.nullable === true) {
      delete schema.nullable;
      if (schema.type) {
        schema.type = Array.isArray(schema.type) ? [...schema.type, "null"] : [schema.type, "null"];
      }
    }
    if (schema.allOf) schema.allOf = schema.allOf.map(transformSchema);
    if (schema.oneOf) schema.oneOf = schema.oneOf.map(transformSchema);
    if (schema.anyOf) schema.anyOf = schema.anyOf.map(transformSchema);
    if (schema.not) schema.not = transformSchema(schema.not);
    return schema;
  }
  if (transformed.paths) {
    for (const pathItem of Object.values(transformed.paths)) {
      for (const operation of Object.values(pathItem)) {
        if (typeof operation !== "object" || !operation) continue;
        const op = operation;
        if (op.requestBody?.content) {
          for (const mediaObj of Object.values(op.requestBody.content)) {
            if (mediaObj.schema) {
              mediaObj.schema = transformSchema(mediaObj.schema);
            }
          }
        }
        if (op.responses) {
          for (const response of Object.values(op.responses)) {
            if (response.content) {
              for (const mediaObj of Object.values(response.content)) {
                if (mediaObj.schema) {
                  mediaObj.schema = transformSchema(mediaObj.schema);
                }
              }
            }
          }
        }
        if (op.parameters) {
          op.parameters = op.parameters.map((param) => {
            if (param.schema) {
              param.schema = transformSchema(param.schema);
            }
            return param;
          });
        }
      }
    }
  }
  if (transformed.components?.schemas) {
    for (const [name, schema] of Object.entries(transformed.components.schemas)) {
      transformed.components.schemas[name] = transformSchema(schema);
    }
  }
  return transformed;
}
function splitOnSeparator(str = "", maxLen, separator = " .") {
  if (str.length <= maxLen) {
    return str;
  }
  const idx = str.lastIndexOf(separator, maxLen);
  if (idx === -1) {
    return str.substring(0, maxLen);
  }
  return str.substring(0, idx);
}

const MCP_SETTINGS_KEY = "mcp";
const isMcpEnabled = (agentData, agentSettings) => {
  if (agentData.usingTestDomain) {
    return true;
  }
  const mcpSettings = agentSettings?.get(MCP_SETTINGS_KEY);
  let isEnabled = false;
  if (mcpSettings) {
    try {
      const parsedMcpSettings = JSON.parse(mcpSettings);
      isEnabled = typeof parsedMcpSettings === "boolean" ? parsedMcpSettings : parsedMcpSettings?.isEnabled;
    } catch (error) {
      isEnabled = false;
    }
  }
  return isEnabled;
};
function extractMCPToolSchema(jsonSpec, method) {
  if (method.toLowerCase() === "get") {
    const schema2 = jsonSpec?.parameters;
    if (!schema2) return {};
    const properties = {};
    const required = [];
    schema2.forEach((param) => {
      if (param.in === "query") {
        properties[param.name] = param.schema;
        if (param.required) {
          required.push(param.name);
        }
      }
    });
    return {
      type: "object",
      properties,
      required
    };
  }
  const schema = jsonSpec?.requestBody?.content?.["application/json"]?.schema;
  return schema;
}
function formatMCPSchemaProperties(schema) {
  const properties = schema?.properties || {};
  for (const property in properties) {
    const propertySchema = properties[property];
    if (propertySchema.type === "array") {
      properties[property] = {
        type: "array",
        items: {
          type: ["string", "number", "boolean", "object", "array"]
        }
      };
    }
  }
  return properties;
}

const console$2 = Logger("Role: MCP");
const clientTransports = /* @__PURE__ */ new Map();
class MCPRole extends BaseRole {
  /**
   * Creates a new MCPRole instance.
   * @param middlewares - The custom middlewares to apply to the role on top of the default middlewares.
   * @param options - The options for the role. Defaults to an empty object.
   */
  constructor(middlewares = [], options = {}) {
    super(middlewares, options);
  }
  async mount(router) {
    const middlewares = [AgentLoader, ...this.middlewares];
    router.get("/sse", middlewares, async (req, res) => {
      try {
        const agentData = req._agentData;
        const agentDataConnector = ConnectorService.getAgentDataConnector();
        const openAPISpec = await agentDataConnector.getOpenAPIJSON(agentData, "localhost", "latest", true);
        const server = new Server(
          {
            name: openAPISpec.info.title,
            version: openAPISpec.info.version
          },
          {
            capabilities: {
              tools: {}
            }
          }
        );
        req.on("error", (error) => {
          console$2.error("Error:", error);
        });
        req.on("close", () => {
          console$2.log("Client disconnected");
          clientTransports.delete(transport.sessionId);
        });
        server.onerror = (error) => {
          console$2.error("Server error:", error);
        };
        server.onclose = async () => {
          console$2.log("Server closing");
        };
        const tools = Object.entries(openAPISpec.paths).map(([path, methods]) => {
          const method = Object.keys(methods)[0];
          const endpoint = path.split("/api/")[1];
          const operation = methods[method];
          const schema = extractMCPToolSchema(operation, method);
          const properties = formatMCPSchemaProperties(schema);
          return {
            name: endpoint,
            description: operation.summary || `Endpoint that handles ${method.toUpperCase()} requests to ${endpoint}. ${schema?.description || ""}`,
            inputSchema: {
              type: "object",
              properties,
              required: schema?.required || []
            }
          };
        });
        server.setRequestHandler(ListToolsRequestSchema, async () => ({
          tools
        }));
        server.setRequestHandler(CallToolRequestSchema, async (request) => {
          try {
            const { name, arguments: args } = request.params;
            if (!args) {
              throw new Error("No arguments provided");
            }
            const tool = tools.find((t) => t.name === name);
            if (!tool) {
              return {
                content: [{ type: "text", text: `Unknown tool: ${name}` }],
                isError: true
              };
            }
            try {
              const pathEntry = Object.entries(openAPISpec.paths).find(([path2]) => path2.split("/api/")[1] === name);
              if (!pathEntry) {
                throw new Error(`Could not find path for tool: ${name}`);
              }
              const [path, methods] = pathEntry;
              const method = Object.keys(methods)[0];
              const result = await AgentProcess.load(agentData).run({
                method,
                path,
                body: args
              });
              return {
                content: [{ type: "text", text: JSON.stringify(result) }],
                isError: false
              };
            } catch (error) {
              return {
                content: [{ type: "text", text: `Error processing request: ${error.message}` }],
                isError: true
              };
            }
          } catch (error) {
            return {
              content: [
                {
                  type: "text",
                  text: `Error: ${error instanceof Error ? error.message : String(error)}`
                }
              ],
              isError: true
            };
          }
        });
        const transport = new SSEServerTransport("/emb/mcp/message", res);
        await server.connect(transport);
        clientTransports.set(transport.sessionId, { transport, server });
        console$2.log("Generated sessionId", transport.sessionId);
        console$2.log("MCP Server running on sse");
      } catch (error) {
        console$2.error(error);
        return res.status(500).send({ error: error.message });
      }
    });
    router.post("/message", async (req, res) => {
      const sessionId = req.query.sessionId;
      console$2.log("Received sessionId", sessionId);
      const transport = clientTransports.get(sessionId)?.transport;
      if (!transport) {
        return res.status(404).send({ error: "Transport not found" });
      }
      await transport.handlePostMessage(req, res, req.body);
    });
  }
}

var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
const console$1 = Logger("Service: Chat");
class OpenAIChatService {
  constructor() {
    __publicField(this, "firstTime", true);
  }
  async chatCompletion({
    apiKey,
    modelId,
    params,
    options
  }) {
    const { agentId, agentVersion } = getAgentIdAndVersion(params.model);
    console$1.log("parsed agentId and agentVersion", agentId, agentVersion);
    if (!apiKey) {
      return new ApiError(401, "Invalid Authentication", "Unauthorized");
    }
    const accessCandidate = AccessCandidate.agent(agentId);
    const vaultConnector = ConnectorService.getVaultConnector();
    const exists = await vaultConnector.user(accessCandidate).exists(apiKey).catch((error) => {
      console$1.error("Error checking if api key exists:", error);
      return false;
    });
    if (!exists) {
      return new ApiError(401, "Incorrect API key provided", "Unauthorized");
    }
    const systemPrompt = params.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
    const conv = new Conversation(modelId, agentId, { agentVersion });
    await conv.ready;
    if (systemPrompt.trim()?.length) {
      conv.systemPrompt += `

######

${systemPrompt}`;
    }
    const history = params.messages.filter((m) => m.role !== "system");
    const lastUserMessageIndx = history.length - 1 - [...history].reverse().findIndex((m) => m.role === "user");
    const lastUserMessage = history.splice(lastUserMessageIndx, 1)[0];
    for (const message of history) {
      const id = crypto.randomUUID();
      switch (message.role) {
        case "user":
          conv.context.addUserMessage(message.content, id);
          break;
        case "assistant":
          conv.context.addAssistantMessage(message.content, id);
          break;
      }
    }
    const completionId = `chatcmpl-${crypto.randomUUID()}`;
    if (params.stream) {
      const readable = new Readable({
        read() {
        }
      });
      conv.on("content", (content) => {
        const now = Date.now();
        const preparedContent = {
          id: completionId,
          object: "chat.completion.chunk",
          created: now,
          model: params.model,
          choices: [{ index: 0, delta: { content }, finish_reason: null }]
        };
        readable.push(`data: ${JSON.stringify(preparedContent)}

`);
      });
      conv.on("beforeToolCall", (info) => {
        const now = Date.now();
        console$1.log("Before Tool Call:", info);
        if (!options?.include_status) return;
        const toolStatusChunk = {
          id: completionId,
          object: "chat.completion.chunk",
          created: now,
          model: params.model,
          choices: [
            {
              finish_reason: null,
              index: 0,
              delta: {
                content: "",
                status: info?.tool?.name
              }
            }
          ]
        };
        readable.push(`data: ${JSON.stringify(toolStatusChunk)}

`);
      });
      conv.on("toolCall", (info) => {
        const now = Date.now();
        console$1.debug("Tool Call:", info);
        const toolStatusChunk = {
          id: completionId,
          object: "chat.completion.chunk",
          created: now,
          model: params.model,
          choices: [
            {
              finish_reason: null,
              index: 0,
              delta: {
                smyth_event: {
                  type: "toolCall",
                  content: info?.tool?.name
                },
                content: ""
              }
            }
          ]
        };
        readable.push(`data: ${JSON.stringify(toolStatusChunk)}

`);
      });
      conv.on("usage", (usage) => {
        const now = Date.now();
        console$1.debug("Usage:", usage);
        const toolStatusChunk = {
          id: completionId,
          object: "chat.completion.chunk",
          created: now,
          model: params.model,
          choices: [
            {
              finish_reason: null,
              index: 0,
              delta: {
                smyth_event: {
                  type: "usage",
                  content: usage
                },
                content: ""
              }
            }
          ]
        };
        readable.push(`data: ${JSON.stringify(toolStatusChunk)}

`);
      });
      conv.on("end", () => {
        console$1.log("streaming: [DONE]");
        readable.push("data: [DONE]\n\n");
        readable.push(null);
      });
      conv.on("error", (error) => {
        console$1.info("streaming: error", error);
        readable.emit("error", error);
      });
      conv.streamPrompt(lastUserMessage?.content, {
        "X-AGENT-ID": agentId
      }).catch((error) => {
        readable.emit("error", error);
      });
      return readable;
    } else {
      const now = Date.now();
      const result = await conv.prompt(lastUserMessage?.content, {
        "X-AGENT-ID": agentId
      });
      return {
        id: completionId,
        object: "chat.completion",
        created: now,
        model: params.model,
        choices: [
          { index: 0, message: { role: "assistant", content: result, refusal: null }, logprobs: null, finish_reason: "stop" }
        ]
      };
    }
  }
  randomlyEmitStatus(readable, completionId, now, params) {
    const shouldEmitStatus = this.firstTime || Math.random() < 0.5;
    if (this.firstTime) {
      this.firstTime = false;
    }
    const randomToolStatus = [
      { text: "Thinking", pauseDelay: 5e3 },
      { text: "Analyzing", pauseDelay: 5e3 }
    ];
    if (shouldEmitStatus) {
      const status = randomToolStatus.pop();
      if (!status) return;
      const statusChunk = {
        id: completionId,
        object: "chat.completion.chunk",
        created: now,
        model: params.model,
        choices: [{ index: 0, delta: { content: "", status: status.text }, finish_reason: null }],
        system_fingerprint: void 0
      };
      readable.push(`data: ${JSON.stringify(statusChunk)}

`);
      readable.pause();
      setTimeout(() => {
        readable.resume();
      }, status.pauseDelay);
    }
  }
  fakeStream() {
    const readable = new Readable({
      read() {
      }
    });
    const sentences = faker.lorem.sentences(10);
    for (const sentence of sentences) {
      const preparedContent = {
        id: crypto.randomUUID(),
        object: "chat.completion.chunk",
        created: Date.now(),
        model: "gpt-4o-mini",
        choices: [{ index: 0, delta: { content: sentence }, finish_reason: null }],
        system_fingerprint: void 0
      };
      readable.push(`data: ${JSON.stringify(preparedContent)}

`);
    }
    readable.push("data: [DONE]\n\n");
    readable.push(null);
    return readable;
  }
}
const chatService = new OpenAIChatService();

const chatValidations = {
  chatCompletion: {
    headers: Joi.object({
      authorization: Joi.string().required()
    }).required(),
    query: Joi.object({
      include_status: Joi.boolean().optional()
    }),
    body: Joi.object({
      messages: Joi.array().items(
        Joi.object({
          role: Joi.string().valid("system", "user", "assistant").required(),
          content: Joi.string().allow(null).required()
        })
      ).required(),
      model: Joi.string().required(),
      stream: Joi.boolean().optional()
    }).required()
  }
};

async function AgentDataAdapter(req, res, next) {
  const agentFromModel = req.body.model ? getAgentIdAndVersion(req.body.model) : {};
  req.headers["x-agent-id"] = req.header("x-agent-id") || agentFromModel.agentId;
  req.headers["x-agent-version"] = req.header("x-agent-version") || agentFromModel.version || "";
  next();
}

const pick = (object, keys) => keys.reduce((newObject, key) => {
  if (object && Object.prototype.hasOwnProperty.call(object, key)) {
    newObject[key] = object[key];
  }
  return newObject;
}, {});
const validate = (schema) => (req, _res, next) => {
  const validSchema = pick(schema, ["params", "query", "body"]);
  const object = pick(req, Object.keys(validSchema));
  const { value, error } = Joi.compile(validSchema).prefs({ errors: { label: "key" }, abortEarly: false }).validate(object);
  if (error) {
    const errorMessage = error.details.map((details) => details.message).join(", ");
    return next(new ApiError(400, errorMessage));
  }
  Object.assign(req, value);
  return next();
};

function extractBearerToken(authHeader) {
  if (!authHeader) {
    return null;
  }
  if (typeof authHeader !== "string" || !authHeader.startsWith("Bearer ")) {
    return null;
  }
  const token = authHeader.slice(7).trim();
  if (!token?.length) {
    return null;
  }
  return token;
}
function createOpenAIError(statusCode, error) {
  return new OpenAI.APIError(
    statusCode,
    {
      code: error?.errKey || error?.code,
      message: error?.message,
      type: error?.name
    },
    error?.message,
    null
  );
}

class OpenAIRole extends BaseRole {
  /**
   * Creates a new OpenAIRole instance.
   * @param middlewares - Additional middlewares to apply after AgentDataAdapter and AgentLoader
   * @param options - Configuration options for the role
   * @param options.model - Optional model override: string for static model, or function to resolve model dynamically
   */
  constructor(middlewares = [], options = {}) {
    super(middlewares, options);
  }
  async mount(router) {
    const middlewares = [AgentDataAdapter, AgentLoader, ...this.middlewares];
    router.post(
      "/v1/chat/completions",
      middlewares,
      validate(chatValidations.chatCompletion),
      async (req, res) => {
        try {
          const agentData = req._agentData;
          const agentSettings = req._agentSettings;
          await agentSettings?.ready();
          const baseModel = agentSettings?.get(DEFAULT_AGENT_MODEL_SETTINGS_KEY) || DEFAULT_AGENT_MODEL;
          const model = this.resolve(
            this.options?.model,
            { baseModel, planInfo: agentData?.planInfo || {} },
            baseModel
          );
          const authHeader = req.headers["authorization"];
          const apiKey = extractBearerToken(authHeader);
          const result = await chatService.chatCompletion({
            apiKey,
            modelId: model,
            params: req.body,
            options: req.query
          });
          if (result instanceof ApiError) {
            const error = createOpenAIError(result.statusCode, result);
            return res.status(result.statusCode).json(error);
          }
          if (result instanceof Readable) {
            res.setHeader("Content-Type", "text/event-stream");
            res.setHeader("Cache-Control", "no-cache");
            res.setHeader("Connection", "keep-alive");
            result.on("error", (error) => {
              console.warn("Chat completion streaming error:", error);
              const status = error?.status || 500;
              const apiError = createOpenAIError(status, error);
              res.status(status).json(apiError);
            });
            result.pipe(res);
          } else {
            res.json(result);
          }
        } catch (error) {
          console.warn("Chat completion error:", error);
          const status = error?.status || 500;
          const apiError = createOpenAIError(status, error);
          return res.status(status).json(apiError);
        }
      }
    );
  }
}

class OpenAPIRole extends BaseRole {
  /**
   * Creates a new OpenAPIRole instance.
   * @param middlewares - The custom middlewares to apply to the role on top of the default middlewares.
   * @param options - The options for the role. Defaults to an empty object.
   */
  constructor(middlewares = [], options = {}) {
    super(middlewares, options);
  }
  async mount(router) {
    const middlewares = [AgentLoader, ...this.middlewares];
    router.get("/api-docs/openapi.json", middlewares, openapiJSONHandler);
    router.get("/api-docs/openapi-llm.json", middlewares, openapiJSON4LLMHandler);
  }
}
async function openapiJSONHandler(req, res) {
  const domain = req.hostname;
  const agentData = req._agentData;
  const agentDataConnector = ConnectorService.getAgentDataConnector();
  const openAPIObj = await agentDataConnector.getOpenAPIJSON(agentData, domain, req._agentVersion, false).catch((error) => {
    console.error(error);
    return { error: error.message };
  });
  if (openAPIObj?.error) {
    return res.status(500).send({ error: openAPIObj.error });
  }
  res.setHeader("Content-Type", "application/json");
  res.send(JSON.stringify(openAPIObj, null, 2));
}
async function openapiJSON4LLMHandler(req, res) {
  const domain = req.hostname;
  const agentData = req._agentData;
  const agentDataConnector = ConnectorService.getAgentDataConnector();
  const openAPIObj = await agentDataConnector.getOpenAPIJSON(agentData, domain, req._agentVersion, true).catch((error) => {
    console.error(error);
    return { error: error.message };
  });
  if (openAPIObj?.error) {
    return res.status(500).send({ error: openAPIObj.error });
  }
  res.setHeader("Content-Type", "application/json");
  res.send(JSON.stringify(openAPIObj, null, 2));
}

class PostmanRole extends BaseRole {
  /**
   * Creates a new PostmanRole instance.
   * @param middlewares - Custom middlewares to apply to the role on top of the default middlewares.
   * @param options - Configuration options for the role.
   * @param options.serverOrigin - The server origin URL. Can be a string or a function that accepts the request and returns a string.
   *                                Used to generate the correct base URL in the OpenAPI spec before conversion.
   *                                Defaults to an empty string.
   */
  constructor(middlewares, options) {
    super(middlewares, options);
  }
  /**
   * Mounts the Postman collection endpoint on the provided router.
   *
   * Creates a GET route that:
   * 1. Loads agent data via AgentLoader middleware
   * 2. Fetches the agent's OpenAPI specification
   * 3. Converts the OpenAPI spec to Postman collection format using openapi-to-postmanv2
   * 4. Returns the Postman collection as a downloadable JSON file
   *
   * @param router - The Express router to mount the endpoint on.
   * @throws Returns 500 error if OpenAPI spec retrieval or conversion fails.
   */
  async mount(router) {
    const middlewares = [AgentLoader, ...this.middlewares];
    router.get("/", middlewares, async (req, res) => {
      const agentData = req._agentData;
      try {
        const serverOrigin = this.resolve(this.options.serverOrigin, req);
        const agentDataConnector = ConnectorService.getAgentDataConnector();
        const openAPISpec = await agentDataConnector.getOpenAPIJSON(agentData, serverOrigin, agentData.version, false).catch((error) => {
          console.error(error);
          return { error: error.message };
        });
        if (openAPISpec?.error) {
          return res.status(500).send({ error: openAPISpec.error });
        }
        const conversionResult = await new Promise((resolve, reject) => {
          Converter.convert({ type: "json", data: openAPISpec }, {}, (err, result) => {
            if (err) {
              reject(err);
            } else if (result.result) {
              resolve(result);
            } else {
              reject(new Error(`Conversion failed: ${result.reason}`));
            }
          });
        });
        const filename = `${agentData.name}.postman.json`;
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.setHeader("Content-Type", "application/json");
        res.send(JSON.stringify(conversionResult?.output?.[0]?.data, null, 2));
      } catch (error) {
        console.error(error);
        return res.status(500).send({ error: error.message });
      }
    });
  }
}

class SwaggerRole extends BaseRole {
  /**
   * Creates a new SwaggerRole instance.
   * @param router - The router to mount the role on.
   * @param middlewares - The custom middlewares to apply to the role on top of the default middlewares.
   * @param options - The options for the role.
   * Accepts:
   * - staticPath: The path to the static files for the role. this assumes that a static route is mounted and the swagger files (swagger.js, swagger-debug.js) are served from this path.
   * Defaults to '/static/embodiment/swagger'.
   */
  constructor(middlewares, options) {
    super(middlewares, {
      staticPath: "/static/embodiment/swagger",
      ...options
    });
  }
  async mount(router) {
    const middlewares = [AgentLoader, ...this.middlewares];
    router.use("/", swaggerUi.serve);
    router.use("/", middlewares, async (req, res) => {
      const agentData = req._agentData;
      const isTestDomain = agentData.usingTestDomain;
      const serverOrigin = this.resolve(this.options.serverOrigin, req);
      const agentDataConnector = ConnectorService.getAgentDataConnector();
      const openApiDocument = await agentDataConnector.getOpenAPIJSON(agentData, serverOrigin, agentData.version, false);
      if (agentData?.auth?.method && agentData?.auth?.method != "none") {
        openApiDocument.components = openApiDocument.components || {};
        openApiDocument.components.securitySchemes = {
          ApiKeyAuth: {
            type: "apiKey",
            in: "header",
            name: "Authorization"
          }
        };
        openApiDocument.security = [{ ApiKeyAuth: [] }];
      }
      let htmlContent = swaggerUi.generateHTML(openApiDocument);
      let debugScript = `<script src="${this.options.staticPath}/swagger.js"><\/script>`;
      if (isTestDomain) {
        debugScript += `
<script src="${this.options.staticPath}/swagger-debug.js"><\/script>
<script>
initDebug('${process.env.UI_SERVER}', '${agentData.id}');
<\/script>
`;
      }
      htmlContent = htmlContent.replace("</body>", `${debugScript}</body>`);
      res.send(htmlContent);
    });
  }
}

export { AgentRole, AlexaRole, BaseRole, ChatGPTRole, DEFAULT_AGENT_MODEL, DEFAULT_AGENT_MODEL_SETTINGS_KEY, MCPRole, OpenAIRole, OpenAPIRole, PostmanRole, SwaggerRole, buildAlexaResponse, chatService, chatValidations, createAlexaSkill, createOpenAIError, createSseConnection, extractAgentVerionsAndPath, extractBearerToken, extractMCPToolSchema, formatMCPSchemaProperties, getAgentDomainById, getAgentIdAndVersion, getDebugSession, getMockData, getSlotValues, handleAlexaRequest, isAlexaEnabled, isMcpEnabled, parseAlexaRequest, processAgentRequest, processAlexaSearchQuery, sseConnections, validate, version };
//# sourceMappingURL=index.js.map
