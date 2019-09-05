'use strict';

µMatrix.webRequest = (function() {
var onBeforeRootFrameRequestHandler = function(details) {
    let µm = µMatrix;
    let desURL = details.url;
    let desHn = µm.URI.hostnameFromURI(desURL);
    let type = requestTypeNormalizer[details.type] || 'other';
    let tabId = details.tabId;

    µm.tabContextManager.push(tabId, desURL);

    let tabContext = µm.tabContextManager.mustLookup(tabId);
    let srcHn = tabContext.rootHostname;

    let blocked = µm.mustBlock(srcHn, desHn, type);

    let pageStore = µm.pageStoreFromTabId(tabId);
    pageStore.recordRequest(type, desURL, blocked);
    pageStore.perLoadAllowedRequestCount = 0;
    pageStore.perLoadBlockedRequestCount = 0;
    µm.logger.writeOne({ tabId, srcHn, desHn, desURL, type, blocked });

    if ( !blocked ) {
        let redirectURL = maybeRedirectRootFrame(desHn, desURL);
        if ( redirectURL !== desURL ) {
            return { redirectUrl: redirectURL };
        }
        µm.cookieHunter.recordPageCookies(pageStore);
        return;
    }

    let query = btoa(JSON.stringify({ url: desURL, hn: desHn, type, why: '?' }));

    vAPI.tabs.replace(tabId, vAPI.getURL('main-blocked.html?details=') + query);

    return { cancel: true };
};

var maybeRedirectRootFrame = function(hostname, url) {
    let µm = µMatrix;
    if ( µm.rawSettings.enforceEscapedFragment !== true ) { return url; }
    let block1pScripts = µm.mustBlock(hostname, hostname, 'script');
    let reEscapedFragment = /[?&]_escaped_fragment_=/;
    if ( reEscapedFragment.test(url) ) {
        return block1pScripts ? url : url.replace(reEscapedFragment, '#!') ;
    }
    if ( block1pScripts === false ) { return url; }
    let pos = url.indexOf('#!');
    if ( pos === -1 ) { return url; }
    let separator = url.lastIndexOf('?', pos) === -1 ? '?' : '&';
    return url.slice(0, pos) +
           separator + '_escaped_fragment_=' +
           url.slice(pos + 2);
};

var onBeforeRequestHandler = function(details) {
    let µm = µMatrix,
        µmuri = µm.URI,
        desURL = details.url,
        desScheme = µmuri.schemeFromURI(desURL);

    if ( µmuri.isNetworkScheme(desScheme) === false ) { return; }

    let type = requestTypeNormalizer[details.type] || 'other';

    if ( type === 'doc' && details.parentFrameId === -1 ) {
        return onBeforeRootFrameRequestHandler(details);
    }

    let tabContext = µm.tabContextManager.mustLookup(details.tabId),
        tabId = tabContext.tabId,
        srcHn = tabContext.rootHostname,
        desHn = µmuri.hostnameFromURI(desURL),
        docURL = details.documentUrl,
        specificity = 0;

    if ( docURL !== undefined ) {
        if ( tabId < 0 ) {
            srcHn = µmuri.hostnameFromURI(µm.normalizePageURL(0, docURL));
        }
        else if (
            details.parentFrameId === -1 &&
            docURL !== tabContext.rawURL
        ) {
            srcHn = µmuri.hostnameFromURI(µm.normalizePageURL(0, docURL));
        }
    }

    let blocked = µm.tMatrix.mustBlock(srcHn, desHn, type);
    if ( blocked ) {
        specificity = µm.tMatrix.specificityRegister;
    }

    let pageStore = µm.mustPageStoreFromTabId(tabId);

    if ( tabContext.secure && µmuri.isSecureScheme(desScheme) === false ) {
        pageStore.hasMixedContent = true;
        if ( blocked === false ) {
            blocked = µm.tMatrix.evaluateSwitchZ('https-strict', srcHn);
        }
    }

    pageStore.recordRequest(type, desURL, blocked);
    if ( µm.logger.enabled ) {
        µm.logger.writeOne({ tabId, srcHn, desHn, desURL, type, blocked });
    }

    if ( blocked ) {
        pageStore.cacheBlockedCollapsible(type, desURL, specificity);
        return { 'cancel': true };
    }
};

var onBeforeSendHeadersHandler = function(details) {
    let µm = µMatrix,
        µmuri = µm.URI,
        desURL = details.url,
        desScheme = µmuri.schemeFromURI(desURL);

    if ( µmuri.isNetworkScheme(desScheme) === false ) { return; }

    const tabId = details.tabId;
    const pageStore = µm.mustPageStoreFromTabId(tabId);
    const desHn = µmuri.hostnameFromURI(desURL);
    const requestType = requestTypeNormalizer[details.type] || 'other';
    const requestHeaders = details.requestHeaders;

    const srcHn = tabId < 0 ||
          details.parentFrameId < 0 ||
          details.parentFrameId === 0 && details.type === 'sub_frame'
        ? µmuri.hostnameFromURI(details.documentUrl) || pageStore.pageHostname
        : pageStore.pageHostname;

    let headerIndex = headerIndexFromName('ping-to', requestHeaders);
    if ( headerIndex !== -1 ) {
        let headerValue = requestHeaders[headerIndex].value;
        if ( headerValue !== '' ) {
            let blocked = µm.userSettings.processHyperlinkAuditing;
            pageStore.recordRequest('other', desURL + '{Ping-To:' + headerValue + '}', blocked);
            µm.logger.writeOne({ tabId, srcHn, desHn, desURL, type: 'ping', blocked });
            if ( blocked ) {
                µm.hyperlinkAuditingFoiledCounter += 1;
                return { 'cancel': true };
            }
        }
    }

    let modified = false;

    headerIndex = headerIndexFromName('cookie', requestHeaders);
    if (
        headerIndex !== -1 &&
        µm.mustBlock(srcHn, desHn, 'cookie')
    ) {
        modified = true;
        let headerValue = requestHeaders[headerIndex].value;
        requestHeaders.splice(headerIndex, 1);
        µm.cookieHeaderFoiledCounter++;
        if ( requestType === 'doc' ) {
            pageStore.perLoadBlockedRequestCount++;
            µm.logger.writeOne({
                tabId,
                srcHn,
                header: { name: 'COOKIE', value: headerValue },
                change: -1
            });
        }
    }

    headerIndex = headerIndexFromName('referer', requestHeaders);
    if ( headerIndex !== -1 ) {
        let headerValue = requestHeaders[headerIndex].value;
        if ( headerValue !== '' ) {
            let toDomain = µmuri.domainFromHostname(desHn);
            if ( toDomain !== '' && toDomain !== µmuri.domainFromURI(headerValue) ) {
                pageStore.has3pReferrer = true;
                if ( µm.tMatrix.evaluateSwitchZ('referrer-spoof', srcHn) ) {
                    modified = true;
                    let newValue;
                    if ( details.method === 'GET' ) {
                        newValue = requestHeaders[headerIndex].value =
                            desScheme + '://' + desHn + '/';
                    } else {
                        requestHeaders.splice(headerIndex, 1);
                    }
                    if ( pageStore.perLoadBlockedReferrerCount === 0 ) {
                        pageStore.perLoadBlockedRequestCount += 1;
                        µm.logger.writeOne({
                            tabId,
                            srcHn,
                            header: { name: 'REFERER', value: headerValue },
                            change: -1
                        });
                        if ( newValue !== undefined ) {
                            µm.logger.writeOne({
                                tabId,
                                srcHn,
                                header: { name: 'REFERER', value: newValue },
                                change: +1
                            });
                        }
                    }
                    pageStore.perLoadBlockedReferrerCount += 1;
                }
            }
        }
    }

    if ( modified !== true ) { return; }

    µm.updateBadgeAsync(tabId);

    return { requestHeaders: requestHeaders };
};

var onHeadersReceivedHandler = function(details) {
    let µm = µMatrix,
        tabId = details.tabId,
        requestURL = details.url,
        requestType = requestTypeNormalizer[details.type] || 'other',
        headers = details.responseHeaders;

    if ( requestType === 'doc' ) {
        µm.tabContextManager.push(tabId, requestURL);
        let contentType = typeFromHeaders(headers);
        if ( contentType !== undefined ) {
            details.type = contentType;
            return onBeforeRootFrameRequestHandler(details);
        }
    }

    let tabContext = µm.tabContextManager.lookup(tabId);
    if ( tabContext === null ) { return; }

    let csp = [],
        cspReport = [],
        srcHn = tabContext.rootHostname,
        desHn = µm.URI.hostnameFromURI(requestURL);

    if ( µm.mustBlock(srcHn, desHn, 'script' ) ) {
        csp.push(µm.cspNoInlineScript);
    }

    if ( µm.mustBlock(srcHn, desHn, 'css' ) ) {
        csp.push(µm.cspNoInlineStyle);
    }

    if ( µm.tMatrix.evaluateSwitchZ('no-workers', srcHn) ) {
        csp.push(µm.cspNoWorker);
    } else if ( µm.rawSettings.disableCSPReportInjection === false ) {
        cspReport.push(µm.cspNoWorker);
    }

    if ( csp.length === 0 && cspReport.length === 0 ) { return; }

    if ( csp.length !== 0 ) {
        let cspRight = csp.join(', ');
        let cspTotal = cspRight;
        if ( µm.cantMergeCSPHeaders ) {
            let i = headerIndexFromName(
                'content-security-policy',
                headers
            );
            if ( i !== -1 ) {
                cspTotal = headers[i].value.trim() + ', ' + cspTotal;
                headers.splice(i, 1);
            }
        }
        headers.push({
            name: 'Content-Security-Policy',
            value: cspTotal
        });
        if ( requestType === 'doc' ) {
            µm.logger.writeOne({
                tabId,
                srcHn,
                header: { name: 'CSP', value: cspRight },
                change: +1
            });
        }
    }

    if ( cspReport.length !== 0 ) {
        let cspRight = cspReport.join(', ');
        let cspTotal = cspRight;
        if ( µm.cantMergeCSPHeaders ) {
            let i = headerIndexFromName(
                'content-security-policy-report-only',
                headers
            );
            if ( i !== -1 ) {
                cspTotal = headers[i].value.trim() + ', ' + cspTotal;
                headers.splice(i, 1);
            }
        }
        headers.push({
            name: 'Content-Security-Policy-Report-Only',
            value: cspTotal
        });
    }

    return { responseHeaders: headers };
};

window.addEventListener('webextFlavor', function() {
    if ( vAPI.webextFlavor.soup.has('firefox') === false ) { return; }
    if ( vAPI.webextFlavor.major <= 57 ) {
        µMatrix.cspNoWorker =
            "child-src 'none'; frame-src data: blob: *; report-uri about:blank";
    }
    if ( vAPI.webextFlavor.major <= 58 ) {
        µMatrix.cantMergeCSPHeaders = true;
    }
}, { once: true });

var headerIndexFromName = function(headerName, headers) {
    var i = headers.length;
    while ( i-- ) {
        if ( headers[i].name.toLowerCase() === headerName ) {
            return i;
        }
    }
    return -1;
};

let typeFromHeaders = function(headers) {
    let i = headerIndexFromName('content-type', headers);
    if ( i === -1 ) { return; }
    let mime = headers[i].value.toLowerCase();
    if ( mime.startsWith('image/') ) { return 'image'; }
    if ( mime.startsWith('video/') || mime.startsWith('audio/') ) {
        return 'media';
    }
};

var requestTypeNormalizer = {
    'font':'css',
    'image':'image',
    'imageset':'image',
    'main_frame':'doc',
    'media':'media',
    'object':'media',
    'other':'other',
    'script':'script',
    'stylesheet':'css',
    'sub_frame':'frame',
    'websocket':'xhr',
    'xmlhttprequest':'xhr'
};

(function() {
    if (
        typeof self.browser !== 'object' ||
        typeof browser.contentScripts !== 'object'
    ) {
        return;
    }

    let csRules = [
        {
            name: 'script',
            file: '/js/contentscript-no-inline-script.js',
            pending: undefined,
            registered: undefined,
            mustRegister: false
        },
    ];

    let csSwitches = [
        {
            name: 'no-workers',
            file: '/js/contentscript-no-workers.js',
            pending: undefined,
            registered: undefined,
            mustRegister: false
        },
    ];

    let register = function(entry) {
        if ( entry.pending !== undefined ) { return; }
        entry.pending = browser.contentScripts.register({
            js: [ { file: entry.file } ],
            matches: [ 'file:///*' ],
            runAt: 'document_start'
        }).then(
            result => {
                if ( entry.mustRegister ) {
                    entry.registered = result;
                }
                entry.pending = undefined;
            },
            ( ) => {
                entry.registered = undefined;
                entry.pending = undefined;
            }
        );
    };

    let unregister = function(entry) {
        if ( entry.registered === undefined ) { return; }
        entry.registered.unregister();
        entry.registered = undefined;
    };

    let handler = function(ev) {
        let matrix = ev && ev.detail;
        if ( matrix !== µMatrix.tMatrix ) { return; }
        for ( let cs of csRules ) {
            cs.mustRegister = matrix.mustBlock('file-scheme', 'file-scheme', cs.name);
            if ( cs.mustRegister === (cs.registered !== undefined) ) { continue; }
            if ( cs.mustRegister ) {
                register(cs);
            } else {
                unregister(cs);
            }
        }
        for ( let cs of csSwitches ) {
            cs.mustRegister = matrix.evaluateSwitchZ(cs.name, 'file-scheme');
            if ( cs.mustRegister === (cs.registered !== undefined) ) { continue; }
            if ( cs.mustRegister ) {
                register(cs);
            } else {
                unregister(cs);
            }
        }
    };

    window.addEventListener('matrixRulesetChange', handler);
})();

const start = (function() {
    if (
        vAPI.net.onBeforeReady instanceof Object &&
        (
            vAPI.net.onBeforeReady.experimental !== true ||
            µMatrix.rawSettings.suspendTabsUntilReady
        )
    ) {
        vAPI.net.onBeforeReady.start();
    }

    return function() {
        vAPI.net.addListener(
            'onBeforeRequest',
            onBeforeRequestHandler,
            { },
            [ 'blocking' ]
        );

        const beforeSendHeadersExtra = [ 'blocking', 'requestHeaders' ];
        const wrObsho = browser.webRequest.OnBeforeSendHeadersOptions;
        if (
            wrObsho instanceof Object &&
            wrObsho.hasOwnProperty('EXTRA_HEADERS')
        ) {
            beforeSendHeadersExtra.push(wrObsho.EXTRA_HEADERS);
        }
        vAPI.net.addListener(
            'onBeforeSendHeaders',
            onBeforeSendHeadersHandler,
            { },
            beforeSendHeadersExtra
        );

        vAPI.net.addListener(
            'onHeadersReceived',
            onHeadersReceivedHandler,
            { types: [ 'main_frame', 'sub_frame' ] },
            [ 'blocking', 'responseHeaders' ]
        );

        if ( vAPI.net.onBeforeReady instanceof Object ) {
            vAPI.net.onBeforeReady.stop(onBeforeRequestHandler);
        }
    };
})();

return { start };

})();
