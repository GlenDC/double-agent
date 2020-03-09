import { IncomingMessage, ServerResponse } from 'http';
import * as fs from 'fs';
import runPage from '../views/runPage';
import startPage from '../views/startPage';
import IDetectionPlugin from '../interfaces/IDetectionPlugin';
import IRequestContext from '../interfaces/IRequestContext';
import HostDomain from '../interfaces/HostDomain';
import resultsPage from '../views/resultsPage';
import SessionTracker from '../lib/SessionTracker';
import IDetectionDomains from '../interfaces/IDetectionDomains';
import extractRequestDetails from './extractRequestDetails';
import { getUseragentPath } from '../lib/useragentProfileHelper';
import getBotScoring from '../lib/getBotScoring';
import IDomainset from '../interfaces/IDomainset';

export default function httpRequestHandler(
  pluginDelegate: IDetectionPlugin,
  domains: IDomainset,
  sessionTracker: SessionTracker,
) {
  return async function requestHandler(req: IncomingMessage, res: ServerResponse) {
    // browserstack sends head requests to check if a domain is active. not part of the tests..
    if (req.method === 'HEAD') {
      return res.end();
    }

    const listeningDomains = domains.listeningDomains;

    const requestUrl = new URL(
      `${listeningDomains.main.protocol}//${req.headers.host}${req.url}`,
    );

    if (!isOndomains(requestUrl, listeningDomains)) {
      return sendMessageReply(
        res,
        400,
        'Please visit this site at ' + listeningDomains.main.href + ' + vs ' + requestUrl.host,
      );
    }

    try {
      const { requestDetails, accessControlHeader } = await extractRequestDetails(req, domains);

      const session = sessionTracker.recordRequest(requestDetails, requestUrl, accessControlHeader);
      const ctx: IRequestContext = {
        req,
        res,
        url: requestUrl,
        requestDetails,
        domains,
        session,
        extraHead: [],
        extraScripts: [],
      };
      await pluginDelegate.onRequest(ctx);

      const botScore = getBotScoring(ctx);

      console.log(
        '%s %s: from %s (%s) %s',
        requestDetails.method,
        requestDetails.url,
        requestDetails.remoteAddress,
        getUseragentPath(req.headers['user-agent']),
        ...botScore,
      );

      if (!requestDetails.cookies.sessionid) {
        const cookie = `sessionid=${session.id}; HttpOnly;`;
        requestDetails.setCookies.push(cookie);
      }
      if (requestDetails.setCookies.length) {
        ctx.res.setHeader('Set-Cookie', requestDetails.setCookies);
      }

      const flow = urlFlow[requestUrl.pathname];
      if (flow) {
        flow(ctx, pluginDelegate);
      } else if (req.method === 'OPTIONS') {
        preflight(ctx);
      } else if (serveFiles[requestUrl.pathname]) {
        sendAsset(ctx);
      } else if (await pluginDelegate.handleResponse(ctx)) {
        // handled
      } else {
        res.writeHead(404).end(JSON.stringify({ message: 'Not found' }));
      }
    } catch (err) {
      console.log('Request error %s %s', req.method, req.url, err);
      res.writeHead(500, err.message).end();
    }
  };
}

const urlFlow = {
  '/': ctx => sendPage(ctx, startPage),
  '/run': ctx =>
    sendRedirect(ctx, HostDomain.Sub, ctx.requestDetails.secureDomain, '/run-redirect'),
  '/run-redirect': ctx =>
    sendRedirect(ctx, HostDomain.External, ctx.requestDetails.secureDomain, '/run-page'),
  '/run-page': ctx => sendPage(ctx, runPage),
  '/results': ctx =>
    sendRedirect(ctx, HostDomain.Sub, ctx.requestDetails.secureDomain, '/results-redirect'),
  '/results-redirect': ctx =>
    sendRedirect(ctx, HostDomain.Main, ctx.requestDetails.secureDomain, '/results-page'),
  '/results-page': ctx => sendPage(ctx, resultsPage),
  '/page-loaded': (ctx, pluginDelegate) => onPageload(ctx, pluginDelegate),
};

const serveFiles = {
  '/main.js': 'application/javascript',
  '/main.css': 'text/css',
  '/world.png': 'image/png',
  '/icon-wildcard.svg': 'image/svg+xml',
  '/favicon.ico': 'image/x-icon',
};

function isOndomains(requestUrl: URL, listeningDomains: IDetectionDomains) {
  return (
    requestUrl.host === listeningDomains.main.host ||
    requestUrl.host === listeningDomains.external.host ||
    requestUrl.host === listeningDomains.subdomain.host
  );
}

function onPageload(ctx: IRequestContext, pluginDelegate: IDetectionPlugin) {
  const page = ctx.url.searchParams.get('page') as string;
  pluginDelegate.onPageLoaded(page, ctx);
  return sendMessageReply(ctx.res, 200, 'Ok');
}

function sendPage(ctx: IRequestContext, render: (ctx: IRequestContext) => string) {
  ctx.res.writeHead(200, {
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    Pragma: 'no-cache',
    Expires: 0,
    'Content-Type': 'text/html',
  });

  const html = render(ctx);
  ctx.res.end(html);
}

function sendRedirect(
  ctx: IRequestContext,
  origin: HostDomain,
  secureDomain: boolean,
  location: string,
) {
  const domains = secureDomain ? ctx.domains.secureDomains : ctx.domains.httpDomains;
  const domain =
    origin === HostDomain.Main
      ? domains.main
      : origin === HostDomain.External
      ? domains.external
      : domains.subdomain;
  ctx.res.writeHead(302, {
    location: `${new URL(location, domain.href)}?sessionid=${ctx.session.id}`,
  });
  ctx.res.end();
}

function preflight(ctx: IRequestContext) {
  ctx.res.writeHead(204, {
    'Access-Control-Allow-Origin': ctx.domains.listeningDomains.main.href,
    'Access-Control-Allow-Methods': 'GET,POST',
    'Access-Control-Allow-Headers': ctx.req.headers['access-control-request-headers'],
    'Content-Length': 0,
    Vary: 'Origin',
  });
  ctx.res.end('');
}

function sendAsset(ctx: IRequestContext) {
  const pathname = ctx.url.pathname;
  ctx.res.writeHead(200, {
    'Content-Type': serveFiles[pathname],
  });
  fs.createReadStream(__dirname + '/../public' + pathname).pipe(ctx.res, {
    end: true,
  });
}

function sendMessageReply(res: ServerResponse, statusCode: number, message: string) {
  res.writeHead(statusCode, {
    'Content-Type': 'text/html',
  });
  res.end(`<html><body><bold style="color:red">${message}</bold></body></html>`);
}
