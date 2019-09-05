'use strict';

(function() {
    const evalMustPunycode = function() {
        return vAPI.webextFlavor.soup.has('firefox') &&
               vAPI.webextFlavor.major < 57;
    };

    let mustPunycode = evalMustPunycode();

    window.addEventListener('webextFlavor', ( ) => {
        mustPunycode = evalMustPunycode();
    }, { once: true });

    const denormalizeTypes = function(aa) {
        if ( aa.length === 0 ) {
            return Array.from(vAPI.net.validTypes);
        }
        const out = new Set();
        let i = aa.length;
        while ( i-- ) {
            let type = aa[i];
            if ( vAPI.net.validTypes.has(type) ) {
                out.add(type);
            }
            if ( type === 'image' && vAPI.net.validTypes.has('imageset') ) {
                out.add('imageset');
            }
            if ( type === 'sub_frame' ) {
                out.add('object');
            }
        }
        return Array.from(out);
    };

    const punycode = self.punycode;
    const reAsciiHostname = /^https?:\/\/[0-9a-z_.:@-]+[/?#]/;
    const parsedURL = new URL('about:blank');

    vAPI.net.normalizeDetails = function(details) {
        if ( mustPunycode && !reAsciiHostname.test(details.url) ) {
            parsedURL.href = details.url;
            details.url = details.url.replace(
                parsedURL.hostname,
                punycode.toASCII(parsedURL.hostname)
            );
        }

        const type = details.type;

        if ( type === 'ping' ) {
            details.type = 'beacon';
            return;
        }

        if ( type === 'imageset' ) {
            details.type = 'image';
            return;
        }

        if ( type === 'object' && Array.isArray(details.responseHeaders) ) {
            for ( const header of details.responseHeaders ) {
                if ( header.name.toLowerCase() === 'content-type' ) {
                    if ( header.value.startsWith('text/html') ) {
                        details.type = 'sub_frame';
                    }
                    break;
                }
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

        const pending = {
            details: Object.assign({}, details),
            resolve: undefined,
            promise: undefined
        };

        pending.promise = new Promise(function(resolve) {
            pending.resolve = resolve;
        });

        pendings.push(pending);

        return pending.promise;
    };

    return {
        start: function() {
            pendings = [];
            browser.webRequest.onBeforeRequest.addListener(
                handler,
                { urls: [ 'http://*/*', 'https://*/*' ] },
                [ 'blocking' ]
            );
        },
        stop: function(resolver) {
            if ( pendings === undefined ) { return; }
            for ( const pending of pendings ) {
                const details = pending.details;
                vAPI.net.normalizeDetails(details);
                pending.resolve(resolver(details));
            }
            pendings = undefined;
        },
    };
})();
