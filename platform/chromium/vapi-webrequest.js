'use strict';

(function() {
    const extToTypeMap = new Map([
        ['eot','font'],['otf','font'],['svg','font'],['ttf','font'],['woff','font'],['woff2','font'],
        ['mp3','media'],['mp4','media'],['webm','media'],
        ['gif','image'],['ico','image'],['jpeg','image'],['jpg','image'],['png','image'],['webp','image']
    ]);

    const denormalizeTypes = function(aa) {
        if ( aa.length === 0 ) {
            return Array.from(vAPI.net.validTypes);
        }
        const out = new Set();
        let i = aa.length;
        while ( i-- ) {
            const type = aa[i];
            if ( vAPI.net.validTypes.has(type) ) {
                out.add(type);
            }
        }
        if ( out.has('other') === false ) {
            for ( const type of extToTypeMap.values() ) {
                if ( out.has(type) ) {
                    out.add('other');
                    break;
                }
            }
        }
        return Array.from(out);
    };

    const headerValue = function(headers, name) {
        let i = headers.length;
        while ( i-- ) {
            if ( headers[i].name.toLowerCase() === name ) {
                return headers[i].value.trim();
            }
        }
        return '';
    };

    const parsedURL = new URL('https://www.example.org/');

    vAPI.net.normalizeDetails = function(details) {
        let type = details.type;

        if ( type === 'main_frame' ) {
            details.documentUrl = details.url;
        }
        else if (
            typeof details.initiator === 'string' &&
            details.initiator !== 'null'
        ) {
            details.documentUrl = details.initiator;
        }

        if ( type === 'ping' ) {
            details.type = 'beacon';
            return;
        }

        if ( type === 'imageset' ) {
            details.type = 'image';
            return;
        }

        if ( type !== 'other' ) { return; }

        parsedURL.href = details.url;
        const path = parsedURL.pathname,
              pos = path.indexOf('.', path.length - 6);
        if ( pos !== -1 && (type = extToTypeMap.get(path.slice(pos + 1))) ) {
            details.type = type;
            return;
        }

        if ( details.responseHeaders ) {
            type = headerValue(details.responseHeaders, 'content-type');
            if ( type.startsWith('font/') ) {
                details.type = 'font';
                return;
            }
            if ( type.startsWith('image/') ) {
                details.type = 'image';
                return;
            }
            if ( type.startsWith('audio/') || type.startsWith('video/') ) {
                details.type = 'media';
                return;
            }
        }
    };

    vAPI.net.denormalizeFilters = function(filters) {
        const urls = filters.urls || [ '<all_urls>' ];
        let types = filters.types;
        if ( Array.isArray(types) ) {
            types = denormalizeTypes(types);
        }
        if (
            (vAPI.net.validTypes.has('websocket')) &&
            (types === undefined || types.indexOf('websocket') !== -1) &&
            (urls.indexOf('<all_urls>') === -1)
        ) {
            if ( urls.indexOf('ws://*/*') === -1 ) {
                urls.push('ws://*/*');
            }
            if ( urls.indexOf('wss://*/*') === -1 ) {
                urls.push('wss://*/*');
            }
        }
        return { types, urls };
    };
})();

vAPI.net.onBeforeReady = (function() {
    let pendings;

    const handler = function(details) {
        if ( pendings === undefined ) { return; }
        if ( details.tabId < 0 ) { return; }

        pendings.add(details.tabId);

        return { cancel: true };
    };

    return {
        experimental: true,
        start: function() {
            pendings = new Set();
            browser.webRequest.onBeforeRequest.addListener(
                handler,
                { urls: [ 'http://*/*', 'https://*/*' ] },
                [ 'blocking' ]
            );
        },
        stop: function() {
            if ( pendings === undefined ) { return; }
            browser.webRequest.onBeforeRequest.removeListener(handler);
            for ( const tabId of pendings ) {
                vAPI.tabs.reload(tabId);
            }
            pendings = undefined;
        },
    };
})();
