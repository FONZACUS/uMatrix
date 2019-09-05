'use strict';

(function() {
var vAPI = self.vAPI = self.vAPI || {};

var chrome = self.chrome;
var manifest = chrome.runtime.getManifest();

var noopFunc = function(){};

var resetLastError = function() {
    void chrome.runtime.lastError;
};

chrome.privacy.network.networkPredictionEnabled.set({ value: false });

vAPI.app = {
    name: manifest.name,
    version: manifest.version
};

vAPI.app.start = function() {
};

vAPI.app.stop = function() {
};

vAPI.app.restart = function() {
    chrome.runtime.reload();
};

vAPI.storage = chrome.storage.local;
vAPI.cacheStorage = chrome.storage.local;

vAPI.tabs = {};

vAPI.isBehindTheSceneTabId = function(tabId) {
    if ( typeof tabId === 'string' ) { debugger; }
    return tabId < 0;
};

vAPI.unsetTabId = 0;
vAPI.noTabId = -1;
vAPI.anyTabId = -2;

vAPI.tabs.registerListeners = function() {
    var onNavigationClient = this.onNavigation || noopFunc;
    var onUpdatedClient = this.onUpdated || noopFunc;
    var onClosedClient = this.onClosed || noopFunc;

    var reGoodForWebRequestAPI = /^https?:\/\//;

    var onCreatedNavigationTarget = function(details) {
        if ( reGoodForWebRequestAPI.test(details.url) ) { return; }
        onNavigationClient(details);
    };

    var onUpdated = function(tabId, changeInfo, tab) {
        onUpdatedClient(tabId, changeInfo, tab);
    };

    var onCommitted = function(details) {
        if ( details.frameId !== 0 ) {
            return;
        }
        onNavigationClient(details);
    };

    var onClosed = function(tabId) {
        onClosedClient(tabId);
    };

    chrome.webNavigation.onCreatedNavigationTarget.addListener(onCreatedNavigationTarget);
    chrome.webNavigation.onCommitted.addListener(onCommitted);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onClosed);
};

vAPI.tabs.get = function(tabId, callback) {
    var onTabReady = function(tab) {
        resetLastError();
        callback(tab);
    };
    if ( tabId !== null ) {
        chrome.tabs.get(tabId, onTabReady);
        return;
    }
    var onTabReceived = function(tabs) {
        resetLastError();
        var tab = null;
        if ( Array.isArray(tabs) && tabs.length !== 0 ) {
            tab = tabs[0];
        }
        callback(tab);
    };
    chrome.tabs.query({ active: true, currentWindow: true }, onTabReceived);
};

vAPI.tabs.getAll = function(callback) {
    chrome.tabs.query({}, callback);
};

vAPI.tabs.open = function(details) {
    var targetURL = details.url;
    if ( typeof targetURL !== 'string' || targetURL === '' ) {
        return null;
    }
    if ( /^[\w-]{2,}:/.test(targetURL) !== true ) {
        targetURL = vAPI.getURL(targetURL);
    }

    var wrapper = function() {
        if ( details.active === undefined ) {
            details.active = true;
        }

        var subWrapper = function() {
            var _details = {
                url: targetURL,
                active: !!details.active
            };

            var focusWindow = function(tab) {
                if ( tab.active ) {
                    chrome.windows.update(tab.windowId, { focused: true });
                }
            };

            if ( !details.tabId ) {
                if ( details.index !== undefined ) {
                    _details.index = details.index;
                }

                chrome.tabs.create(_details, focusWindow);
                return;
            }

            chrome.tabs.update(details.tabId, _details, function(tab) {
                if ( vAPI.lastError() ) {
                    chrome.tabs.create(_details, focusWindow);
                } else if ( details.index !== undefined ) {
                    chrome.tabs.move(tab.id, {index: details.index});
                }
            });
        };

        if ( details.popup === true ) {
            chrome.windows.create({ url: details.url, type: 'popup' });
            return;
        }

        if ( details.index !== -1 ) {
            subWrapper();
            return;
        }

        vAPI.tabs.get(null, function(tab) {
            if ( tab ) {
                details.index = tab.index + 1;
            } else {
                delete details.index;
            }

            subWrapper();
        });
    };

    if ( !details.select ) {
        wrapper();
        return;
    }

    chrome.tabs.query({ url: targetURL }, function(tabs) {
        resetLastError();
        var tab = Array.isArray(tabs) && tabs[0];
        if ( tab ) {
            chrome.tabs.update(tab.id, { active: true }, function(tab) {
                chrome.windows.update(tab.windowId, { focused: true });
            });
        } else {
            wrapper();
        }
    });
};

vAPI.tabs.replace = function(tabId, url) {
    var targetURL = url;

    if ( /^[\w-]{2,}:/.test(targetURL) !== true ) {
        targetURL = vAPI.getURL(targetURL);
    }

    if ( typeof tabId !== 'number' || tabId < 0 ) { return; }

    chrome.tabs.update(tabId, { url: targetURL }, resetLastError);
};

vAPI.tabs.reload = function(tabId, bypassCache) {
    if ( typeof tabId !== 'number' || tabId < 0 ) { return; }
    chrome.tabs.reload(tabId, { bypassCache: bypassCache === true });
};

vAPI.setIcon = (function() {
    let onIconReady = function(tabId, badgeDetails) {
        if ( vAPI.lastError() ) { return; }
        if ( badgeDetails.text !== undefined ) {
            chrome.browserAction.setBadgeText({
                tabId: tabId,
                text: badgeDetails.text
            });
        }
        if ( badgeDetails.color !== undefined ) {
            chrome.browserAction.setBadgeBackgroundColor({
                tabId: tabId,
                color: badgeDetails.color
            });
        }
    };

    return function(tabId, iconDetails, badgeDetails) {
        if ( typeof tabId !== 'number' || tabId < 0 ) { return; }
        chrome.browserAction.setIcon(
            { tabId: tabId, path: iconDetails },
            function() { onIconReady(tabId, badgeDetails); }
        );
    };
})();

vAPI.messaging = {
    ports: new Map(),
    listeners: {},
    defaultHandler: null,
    NOOPFUNC: noopFunc,
    UNHANDLED: 'vAPI.messaging.notHandled'
};

vAPI.messaging.listen = function(listenerName, callback) {
    this.listeners[listenerName] = callback;
};

vAPI.messaging.onPortMessage = (function() {
    var messaging = vAPI.messaging;

    var CallbackWrapper = function(port, request) {
        this.callback = this.proxy.bind(this);
        this.init(port, request);
    };

    CallbackWrapper.prototype = {
        init: function(port, request) {
            this.port = port;
            this.request = request;
            return this;
        },
        proxy: function(response) {
            if ( messaging.ports.has(this.port.name) ) {
                this.port.postMessage({
                    auxProcessId: this.request.auxProcessId,
                    channelName: this.request.channelName,
                    msg: response !== undefined ? response : null
                });
            }
            this.port = this.request = null;
            callbackWrapperJunkyard.push(this);
        }
    };

    var callbackWrapperJunkyard = [];

    var callbackWrapperFactory = function(port, request) {
        var wrapper = callbackWrapperJunkyard.pop();
        if ( wrapper ) {
            return wrapper.init(port, request);
        }
        return new CallbackWrapper(port, request);
    };

    chrome.tabs.onRemoved.addListener(function(tabId) {
        for ( var port of messaging.ports.values() ) {
            var tab = port.sender && port.sender.tab;
            if ( !tab ) { continue; }
            if ( tab.id === tabId ) {
                vAPI.messaging.onPortDisconnect(port);
            }
        }
    });

    return function(request, port) {
        var callback = this.NOOPFUNC;
        if ( request.auxProcessId !== undefined ) {
            callback = callbackWrapperFactory(port, request).callback;
        }

        var r = this.UNHANDLED,
            listener = this.listeners[request.channelName];
        if ( typeof listener === 'function' ) {
            r = listener(request.msg, port.sender, callback);
        }
        if ( r !== this.UNHANDLED ) { return; }

        r = this.defaultHandler(request.msg, port.sender, callback);
        if ( r !== this.UNHANDLED ) { return; }

        console.error(
            'vAPI.messaging.onPortMessage > unhandled request: %o',
            request
        );

        callback();
    }.bind(vAPI.messaging);
})();

vAPI.messaging.onPortDisconnect = function(port) {
    port.onDisconnect.removeListener(this.onPortDisconnect);
    port.onMessage.removeListener(this.onPortMessage);
    this.ports.delete(port.name);
}.bind(vAPI.messaging);

vAPI.messaging.onPortConnect = function(port) {
    port.onDisconnect.addListener(this.onPortDisconnect);
    port.onMessage.addListener(this.onPortMessage);
    this.ports.set(port.name, port);
}.bind(vAPI.messaging);

vAPI.messaging.setup = function(defaultHandler) {
    if ( this.defaultHandler !== null ) { return; }

    if ( typeof defaultHandler !== 'function' ) {
        defaultHandler = function(){
            return vAPI.messaging.UNHANDLED;
        };
    }
    this.defaultHandler = defaultHandler;

    chrome.runtime.onConnect.addListener(this.onPortConnect);
};

vAPI.messaging.broadcast = function(message) {
    var messageWrapper = {
        broadcast: true,
        msg: message
    };
    for ( var port of this.ports.values() ) {
        port.postMessage(messageWrapper);
    }
};

vAPI.net = {
    listenerMap: new WeakMap(),
    validTypes: (function() {
        let types = new Set([
            'main_frame',
            'sub_frame',
            'stylesheet',
            'script',
            'image',
            'object',
            'xmlhttprequest',
            'other'
        ]);
        let wrrt = browser.webRequest.ResourceType;
        if ( wrrt instanceof Object ) {
            for ( let typeKey in wrrt ) {
                if ( wrrt.hasOwnProperty(typeKey) ) {
                    types.add(wrrt[typeKey]);
                }
            }
        }
        return types;
    })(),
    denormalizeFilters: null,
    normalizeDetails: null,
    addListener: function(which, clientListener, filters, options) {
        if ( typeof this.denormalizeFilters === 'function' ) {
            filters = this.denormalizeFilters(filters);
        }
        let actualListener;
        if ( typeof this.normalizeDetails === 'function' ) {
            actualListener = function(details) {
                vAPI.net.normalizeDetails(details);
                return clientListener(details);
            };
            this.listenerMap.set(clientListener, actualListener);
        }
        browser.webRequest[which].addListener(
            actualListener || clientListener,
            filters,
            options
        );
    },
    removeListener: function(which, clientListener) {
        let actualListener = this.listenerMap.get(clientListener);
        if ( actualListener !== undefined ) {
            this.listenerMap.delete(clientListener);
        }
        browser.webRequest[which].removeListener(
            actualListener || clientListener
        );
    },
};

vAPI.lastError = function() {
    return chrome.runtime.lastError;
};

vAPI.browserData = {};

vAPI.browserData.clearCache = function(callback) {
    chrome.browsingData.removeCache({ since: 0 }, callback);
};

vAPI.cookies = {};

vAPI.cookies.start = function() {
    var reallyRemoved = {
        'evicted': true,
        'expired': true,
        'explicit': true
    };

    var onChanged = function(changeInfo) {
        if ( changeInfo.removed ) {
            if ( reallyRemoved[changeInfo.cause] && typeof this.onRemoved === 'function' ) {
                this.onRemoved(changeInfo.cookie);
            }
            return;
        }
        if ( typeof this.onChanged === 'function' ) {
            this.onChanged(changeInfo.cookie);
        }
    };

    chrome.cookies.onChanged.addListener(onChanged.bind(this));
};

vAPI.cookies.getAll = function(callback) {
    chrome.cookies.getAll({}, callback);
};

vAPI.cookies.remove = function(details, callback) {
    chrome.cookies.remove(details, callback || noopFunc);
};

vAPI.cloud = (function() {
    if ( chrome.storage.sync instanceof Object === false ) {
        return;
    }

    var chunkCountPerFetch = 16;

    var maxChunkCountPerItem = Math.floor(512 * 0.75) & ~(chunkCountPerFetch - 1);

    var evalMaxChunkSize = function() {
        return Math.floor(
            (chrome.storage.sync.QUOTA_BYTES_PER_ITEM || 8192) *
            (vAPI.webextFlavor.soup.has('firefox') ? 0.6 : 0.75)
        );
    };

    var maxChunkSize = evalMaxChunkSize();

    window.addEventListener('webextFlavor', function() {
        maxChunkSize = evalMaxChunkSize();
    }, { once: true });

    var maxStorageSize = chrome.storage.sync.QUOTA_BYTES || 102400;

    var options = {
        defaultDeviceName: window.navigator.platform,
        deviceName: vAPI.localStorage.getItem('deviceName') || ''
    };

    var getCoarseChunkCount = function(dataKey, callback) {
        let bin = {};
        for ( let i = 0; i < maxChunkCountPerItem; i += 16 ) {
            bin[dataKey + i.toString()] = '';
        }

        chrome.storage.sync.get(bin, function(bin) {
            if ( chrome.runtime.lastError ) {
                callback(0, chrome.runtime.lastError.message);
                return;
            }

            var chunkCount = 0;
            for ( let i = 0; i < maxChunkCountPerItem; i += 16 ) {
                if ( bin[dataKey + i.toString()] === '' ) { break; }
                chunkCount = i + 16;
            }

            callback(chunkCount);
        });
    };

    var deleteChunks = function(dataKey, start) {
        var keys = [];

        var n = Math.min(
            maxChunkCountPerItem,
            Math.ceil(maxStorageSize / maxChunkSize)
        );
        for ( var i = start; i < n; i++ ) {
            keys.push(dataKey + i.toString());
        }
        chrome.storage.sync.remove(keys);
    };

    var start = function() {
    };

    var push = function(dataKey, data, callback) {
        var bin = {
            'source': options.deviceName || options.defaultDeviceName,
            'tstamp': Date.now(),
            'data': data,
            'size': 0
        };
        bin.size = JSON.stringify(bin).length;
        var item = JSON.stringify(bin);

        bin = {};
        var chunkCount = Math.ceil(item.length / maxChunkSize);
        for ( var i = 0; i < chunkCount; i++ ) {
            bin[dataKey + i.toString()] = item.substr(i * maxChunkSize, maxChunkSize);
        }
        bin[dataKey + i.toString()] = '';

        chrome.storage.sync.set(bin, function() {
            var errorStr;
            if ( chrome.runtime.lastError ) {
                errorStr = chrome.runtime.lastError.message;
                chunkCount = 0;
            }
            callback(errorStr);

            deleteChunks(dataKey, chunkCount);
        });
    };

    var pull = function(dataKey, callback) {
        var assembleChunks = function(bin) {
            if ( chrome.runtime.lastError ) {
                callback(null, chrome.runtime.lastError.message);
                return;
            }

            let json = [], jsonSlice;
            let i = 0;
            for (;;) {
                jsonSlice = bin[dataKey + i.toString()];
                if ( jsonSlice === '' || jsonSlice === undefined ) { break; }
                json.push(jsonSlice);
                i += 1;
            }

            let entry = null;
            try {
                entry = JSON.parse(json.join(''));
            } catch(ex) {
            }
            callback(entry);
        };

        var fetchChunks = function(coarseCount, errorStr) {
            if ( coarseCount === 0 || typeof errorStr === 'string' ) {
                callback(null, errorStr);
                return;
            }

            var bin = {};
            for ( var i = 0; i < coarseCount; i++ ) {
                bin[dataKey + i.toString()] = '';
            }

            chrome.storage.sync.get(bin, assembleChunks);
        };

        getCoarseChunkCount(dataKey, fetchChunks);
    };

    var getOptions = function(callback) {
        if ( typeof callback !== 'function' ) {
            return;
        }
        callback(options);
    };

    var setOptions = function(details, callback) {
        if ( typeof details !== 'object' || details === null ) {
            return;
        }

        if ( typeof details.deviceName === 'string' ) {
            vAPI.localStorage.setItem('deviceName', details.deviceName);
            options.deviceName = details.deviceName;
        }

        getOptions(callback);
    };

    return {
        start: start,
        push: push,
        pull: pull,
        getOptions: getOptions,
        setOptions: setOptions
    };
})();

})();
