import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import Handlebars from "handlebars";
import { addRoute, createRouter, findRoute, } from "rou3";
import { parseArgs } from "node:util";

const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
        addr: {
            default: "localhost:3000",
            type: "string",
        }
    }
});

const [host, port] = values.addr.split(":");

const emails = path.resolve("./emails");
const config = JSON.parse(fs.readFileSync("./com-config.json", "utf-8"));
const languages = fs
    .readdirSync(emails, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dir => dir.name);

const themes = Object.entries(config).map(([theme, templates]) => {
    return {
        name: theme,
        templates: Object.keys(templates)
    };
});

const variablesTemplate = fs.readFileSync(resolveView("./variables.hbs"), "utf-8");


/** @type {Map<string, any>} */
const variables = new Map();

/**
 * GET /
 * @param {http.IncomingMessage} request
 * @param {http.ServerResponse} response
 * @return {Promise<void>}
 */
async function rootHandler(request, response) {
    const homePage = fs.readFileSync(resolveView("./index.hbs"), "utf-8");
    const html = Handlebars.compile(homePage)({
        variables: formatVariables(variables),
        languages,
        themes
    });
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end(html);
}

/**
 * POST /variables
 * @param {http.IncomingMessage} request
 * @param {http.ServerResponse} response
 * @return {Promise<void>}
 */
async function variablesHandler(request, response) {
    const content = await text(request);
    const body = new URLSearchParams(content);
    const key = body.get("key");
    const value = body.get("value");

    variables.set(key, value);

    const html = formatVariables(variables);
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end(html);
}

/**
 * GET /{lang}/{theme}/{template}
 * @param {http.IncomingMessage} request
 * @param  {http.ServerResponse} response
 * @param {Record<string, string>} params
 * @return {Promise<void>}
 */
async function renderEmailHandler(request, response, params) {
    const { lang, theme, template } = params;

    const themeContent = await fs.promises.readFile(resolveTheme(lang, theme), "utf-8");
    const bodyContent = await fs.promises.readFile(resolveBody(lang, template), "utf-8");

    const templateConfig = config[theme][template];

    const vars = Object.fromEntries(variables);
    const htmlBody = Handlebars.compile(bodyContent)({ ...vars });
    const html = Handlebars.compile(themeContent)({
        ...vars,
        title: templateConfig.title,
        body: htmlBody
    });

    response.writeHead(200, { "Content-Type": "text/html" });
    response.end(html);
}

const router = createRouter();
addRoute(router, "GET", "/:lang/:theme/:template", { handler: renderEmailHandler });
addRoute(router, "POST", "/variables", { handler: variablesHandler });
addRoute(router, "GET", "/*", { handler: rootHandler });


const server = http.createServer(
    /**
     * @param {http.IncomingMessage} request
     * @param {http.ServerResponse} response
     * @return {Promise<void>}
     */
    async function (request, response) {
        try {
            const url = new URL(request.url, `http://${request.headers.host}`);
            const matched = findRoute(router, request.method, url.pathname);
            if (matched == null) {
                return await rootHandler(request, response);
            } else {
                return await matched.data.handler(request, response, matched.params);
            }
        } catch (error) {
            console.error(error);
            response.writeHead(500, { "Content-Type": "text/plain" });
            response.end("Internal Server Error");
        }
    });

server.listen({
    host,
    port,
}, () => {
    console.log(`Listening on http://localhost:${port}`);
});

/**
 *  @param {Map<string, any>} variables
 *  @returns {string}
 */
function formatVariables(variables) {
    const records = Array.from(variables.entries())
        .map(([key, value]) => ({ key, value }));

    return Handlebars.compile(variablesTemplate)({
        variables: records,
    });
}

/**
 *
 * @param {http.IncomingMessage} request
 * @returns {Promise<string>}
 */
function text(request) {
    return new Promise((resolve, reject) => {
        let body = "";
        request.on("data", chunk => body += chunk.toString());
        request.on("end", () => resolve(body));
        request.on("error", reject);
    });
}

/**
 * @param {string} lang
 * @param {string} theme
 * @returns {string}
 */
function resolveTheme(lang, theme) {
    const filename = `${theme}.hbs`;
    return path.resolve(emails, lang, "themes", filename);
}

/**
 *
 * @param {string} lang
 * @param  {string} template
 * @returns {string}
 */
function resolveBody(lang, template) {
    const filename = `${template}.hbs`;
    return path.resolve(emails, lang, "bodies", filename);
}

/**
 *
 * @param {string} filename
 * @returns {string}
 */
function resolveView(filename) {
    return path.resolve("./view", filename)
}
