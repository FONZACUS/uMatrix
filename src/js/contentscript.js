'use strict';

(function() {
if (
    document instanceof HTMLDocument === false &&
    document instanceof XMLDocument === false
) {
    return;
}

if ( !window.location ) {
    return;
}

if ( typeof vAPI !== 'object' ) {
    return;
}

if ( vAPI.contentscriptEndInjected ) {
    return;
}
vAPI.contentscriptEndInjected = true;

(function() {
    var localStorageHandler = function(mustRemove) {
        if ( mustRemove ) {
            window.localStorage.clear();
            window.sessionStorage.clear();
        }
    };

    try {
        var hasLocalStorage =
            window.localStorage && window.localStorage.length !== 0;
        var hasSessionStorage =
            window.sessionStorage && window.sessionStorage.length !== 0;
        if ( hasLocalStorage || hasSessionStorage ) {
            vAPI.messaging.send('contentscript.js', {
                what: 'contentScriptHasLocalStorage',
                originURL: window.location.origin
            }, localStorageHandler);
        }

    }
    catch (e) {
    }
})();

var collapser = (function() {
    var resquestIdGenerator = 1,
        processTimer,
        toProcess = [],
        toFilter = [],
        toCollapse = new Map(),
        cachedBlockedMap,
        cachedBlockedMapHash,
        cachedBlockedMapTimer,
        reURLPlaceholder = /\{\{url\}\}/g;
    var src1stProps = {
        'embed': 'src',
        'frame': 'src',
        'iframe': 'src',
        'img': 'src',
        'object': 'data'
    };
    var src2ndProps = {
        'img': 'srcset'
    };
    var tagToTypeMap = {
        embed: 'media',
        frame: 'frame',
        iframe: 'frame',
        img: 'image',
        object: 'media'
    };
    var cachedBlockedSetClear = function() {
        cachedBlockedMap =
        cachedBlockedMapHash =
        cachedBlockedMapTimer = undefined;
    };

    var onProcessed = function(response) {
        if ( !response ) {
            toCollapse.clear();
            return;
        }

        var targets = toCollapse.get(response.id);
        if ( targets === undefined ) { return; }
        toCollapse.delete(response.id);
        if ( cachedBlockedMapHash !== response.hash ) {
            cachedBlockedMap = new Map(response.blockedResources);
            cachedBlockedMapHash = response.hash;
            if ( cachedBlockedMapTimer !== undefined ) {
                clearTimeout(cachedBlockedMapTimer);
            }
            cachedBlockedMapTimer = vAPI.setTimeout(cachedBlockedSetClear, 30000);
        }
        if ( cachedBlockedMap === undefined || cachedBlockedMap.size === 0 ) {
            return;
        }

        let placeholders = response.placeholders;

        for ( let target of targets ) {
            let tag = target.localName;
            let prop = src1stProps[tag];
            if ( prop === undefined ) { continue; }
            let src = target[prop];
            if ( typeof src !== 'string' || src.length === 0 ) {
                prop = src2ndProps[tag];
                if ( prop === undefined ) { continue; }
                src = target[prop];
                if ( typeof src !== 'string' || src.length === 0 ) { continue; }
            }
            let collapsed = cachedBlockedMap.get(tagToTypeMap[tag] + ' ' + src);
            if ( collapsed === undefined ) { continue; }
            if ( collapsed ) {
                target.style.setProperty('display', 'none', 'important');
                target.hidden = true;
                continue;
            }
            switch ( tag ) {
            case 'frame':
            case 'iframe':
                if ( placeholders.frame !== true ) { break; }
                let docurl =
                    'data:text/html,' +
                    encodeURIComponent(
                        placeholders.frameDocument.replace(
                            reURLPlaceholder,
                            src
                        )
                    );
                let replaced = false;
                if ( target.contentWindow ) {
                    try {
                        target.contentWindow.location.replace(docurl);
                        replaced = true;
                    } catch(ex) {
                    }
                }
                if ( !replaced ) {
                    target.setAttribute('src', docurl);
                }
                break;
            case 'img':
                if ( placeholders.image !== true ) { break; }
                if (
                    target.complete &&
                    target.naturalWidth !== 0 &&
                    target.naturalHeight !== 0
                ) {
                    break;
                }
                target.style.setProperty('display', 'inline-block');
                target.style.setProperty('min-width', '20px', 'important');
                target.style.setProperty('min-height', '20px', 'important');
                target.style.setProperty(
                    'border',
                    placeholders.imageBorder,
                    'important'
                );
                target.style.setProperty(
                    'background',
                    placeholders.imageBackground,
                    'important'
                );
                break;
            }
        }
    };

    var send = function() {
        processTimer = undefined;
        toCollapse.set(resquestIdGenerator, toProcess);
        var msg = {
            what: 'lookupBlockedCollapsibles',
            id: resquestIdGenerator,
            toFilter: toFilter,
            hash: cachedBlockedMapHash
        };
        vAPI.messaging.send('contentscript.js', msg, onProcessed);
        toProcess = [];
        toFilter = [];
        resquestIdGenerator += 1;
    };

    var process = function(delay) {
        if ( toProcess.length === 0 ) { return; }
        if ( delay === 0 ) {
            if ( processTimer !== undefined ) {
                clearTimeout(processTimer);
            }
            send();
        } else if ( processTimer === undefined ) {
            processTimer = vAPI.setTimeout(send, delay || 47);
        }
    };

    var add = function(target) {
        toProcess.push(target);
    };

    var addMany = function(targets) {
        var i = targets.length;
        while ( i-- ) {
            toProcess.push(targets[i]);
        }
    };

    var iframeSourceModified = function(mutations) {
        var i = mutations.length;
        while ( i-- ) {
            addIFrame(mutations[i].target, true);
        }
        process();
    };
    var iframeSourceObserver;
    var iframeSourceObserverOptions = {
        attributes: true,
        attributeFilter: [ 'src' ]
    };

    var addIFrame = function(iframe, dontObserve) {
        if ( dontObserve !== true ) {
            if ( iframeSourceObserver === undefined ) {
                iframeSourceObserver = new MutationObserver(iframeSourceModified);
            }
            iframeSourceObserver.observe(iframe, iframeSourceObserverOptions);
        }
        var src = iframe.src;
        if ( src === '' || typeof src !== 'string' ) { return; }
        if ( src.startsWith('http') === false ) { return; }
        toFilter.push({ type: 'frame', url: iframe.src });
        add(iframe);
    };

    var addIFrames = function(iframes) {
        var i = iframes.length;
        while ( i-- ) {
            addIFrame(iframes[i]);
        }
    };

    var addNodeList = function(nodeList) {
        var node,
            i = nodeList.length;
        while ( i-- ) {
            node = nodeList[i];
            if ( node.nodeType !== 1 ) { continue; }
            if ( node.localName === 'iframe' || node.localName === 'frame' ) {
                addIFrame(node);
            }
            if ( node.childElementCount !== 0 ) {
                addIFrames(node.querySelectorAll('iframe, frame'));
            }
        }
    };

    var onResourceFailed = function(ev) {
        if ( tagToTypeMap[ev.target.localName] !== undefined ) {
            add(ev.target);
            process();
        }
    };
    document.addEventListener('error', onResourceFailed, true);

    vAPI.shutdown.add(function() {
        document.removeEventListener('error', onResourceFailed, true);
        if ( iframeSourceObserver !== undefined ) {
            iframeSourceObserver.disconnect();
            iframeSourceObserver = undefined;
        }
        if ( processTimer !== undefined ) {
            clearTimeout(processTimer);
            processTimer = undefined;
        }
    });

    return {
        addMany: addMany,
        addIFrames: addIFrames,
        addNodeList: addNodeList,
        process: process
    };
})();

(function() {
    if ( !document.body ) { return; }

    var addedNodeLists = [];
    var addedNodeListsTimer;

    var treeMutationObservedHandler = function() {
        addedNodeListsTimer = undefined;
        var i = addedNodeLists.length;
        while ( i-- ) {
            collapser.addNodeList(addedNodeLists[i]);
        }
        collapser.process();
        addedNodeLists = [];
    };

    var treeMutationObservedHandlerAsync = function(mutations) {
        var iMutation = mutations.length,
            nodeList;
        while ( iMutation-- ) {
            nodeList = mutations[iMutation].addedNodes;
            if ( nodeList.length !== 0 ) {
                addedNodeLists.push(nodeList);
            }
        }
        if ( addedNodeListsTimer === undefined ) {
            addedNodeListsTimer = vAPI.setTimeout(treeMutationObservedHandler, 47);
        }
    };

    var treeObserver = new MutationObserver(treeMutationObservedHandlerAsync);
    treeObserver.observe(document.body, {
        childList: true,
        subtree: true
    });

    vAPI.shutdown.add(function() {
        if ( addedNodeListsTimer !== undefined ) {
            clearTimeout(addedNodeListsTimer);
            addedNodeListsTimer = undefined;
        }
        if ( treeObserver !== null ) {
            treeObserver.disconnect();
            treeObserver = undefined;
        }
        addedNodeLists = [];
    });
})();

(function() {
    if (
        document.querySelector('script:not([src])') !== null ||
        document.querySelector('a[href^="javascript:"]') !== null ||
        document.querySelector('[onabort],[onblur],[oncancel],[oncanplay],[oncanplaythrough],[onchange],[onclick],[onclose],[oncontextmenu],[oncuechange],[ondblclick],[ondrag],[ondragend],[ondragenter],[ondragexit],[ondragleave],[ondragover],[ondragstart],[ondrop],[ondurationchange],[onemptied],[onended],[onerror],[onfocus],[oninput],[oninvalid],[onkeydown],[onkeypress],[onkeyup],[onload],[onloadeddata],[onloadedmetadata],[onloadstart],[onmousedown],[onmouseenter],[onmouseleave],[onmousemove],[onmouseout],[onmouseover],[onmouseup],[onwheel],[onpause],[onplay],[onplaying],[onprogress],[onratechange],[onreset],[onresize],[onscroll],[onseeked],[onseeking],[onselect],[onshow],[onstalled],[onsubmit],[onsuspend],[ontimeupdate],[ontoggle],[onvolumechange],[onwaiting],[onafterprint],[onbeforeprint],[onbeforeunload],[onhashchange],[onlanguagechange],[onmessage],[onoffline],[ononline],[onpagehide],[onpageshow],[onrejectionhandled],[onpopstate],[onstorage],[onunhandledrejection],[onunload],[oncopy],[oncut],[onpaste]') !== null
    ) {
        vAPI.messaging.send('contentscript.js', {
            what: 'securityPolicyViolation',
            directive: 'script-src',
            documentURI: window.location.href
        });
    }

    if ( document.querySelector('style,[style]') !== null ) {
        vAPI.messaging.send('contentscript.js', {
            what: 'securityPolicyViolation',
            directive: 'style-src',
            documentURI: window.location.href
        });
    }

    collapser.addMany(document.querySelectorAll('img'));
    collapser.addIFrames(document.querySelectorAll('iframe, frame'));
    collapser.process();
})();

(function() {
    var noscripts = document.querySelectorAll('noscript');
    if ( noscripts.length === 0 ) { return; }

    var redirectTimer,
        reMetaContent = /^\s*(\d+)\s*;\s*url=(['"]?)([^'"]+)\2/i,
        reSafeURL = /^https?:\/\//;

    var autoRefresh = function(root) {
        var meta = root.querySelector('meta[http-equiv="refresh"][content]');
        if ( meta === null ) { return; }
        var match = reMetaContent.exec(meta.getAttribute('content'));
        if ( match === null || match[3].trim() === '' ) { return; }
        var url = new URL(match[3], document.baseURI);
        if ( reSafeURL.test(url.href) === false ) { return; }
        redirectTimer = setTimeout(
            function() {
                location.assign(url.href);
            },
            parseInt(match[1], 10) * 1000 + 1
        );
        meta.parentNode.removeChild(meta);
    };

    var morphNoscript = function(from) {
        if ( /^application\/(?:xhtml\+)?xml/.test(document.contentType) ) {
            var to = document.createElement('span');
            while ( from.firstChild !== null ) {
                to.appendChild(from.firstChild);
            }
            return to;
        }
        var parser = new DOMParser();
        var doc = parser.parseFromString(
            '<span>' + from.textContent + '</span>',
            'text/html'
        );
        return document.adoptNode(doc.querySelector('span'));
    };

    var renderNoscriptTags = function(response) {
        if ( response !== true ) { return; }
        var parent, span;
        for ( var noscript of noscripts ) {
            parent = noscript.parentNode;
            if ( parent === null ) { continue; }
            span = morphNoscript(noscript);
            span.style.setProperty('display', 'inline', 'important');
            if ( redirectTimer === undefined ) {
                autoRefresh(span);
            }
            parent.replaceChild(span, noscript);
        }
    };

    vAPI.messaging.send(
        'contentscript.js',
        { what: 'mustRenderNoscriptTags?' },
        renderNoscriptTags
    );
})();

vAPI.messaging.send(
    'contentscript.js',
    { what: 'shutdown?' },
    function(response) {
        if ( response === true ) {
            vAPI.shutdown.exec();
        }
    }
);

})();
