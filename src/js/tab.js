(function() {
'use strict';

var µm = µMatrix;

µm.normalizePageURL = function(tabId, pageURL) {
    if ( vAPI.isBehindTheSceneTabId(tabId) ) {
        return 'http://' + this.behindTheSceneScope + '/';
    }

    if ( pageURL.startsWith('wyciwyg:') ) {
        let match = /^wyciwyg:\/\/\d+\//.exec(pageURL);
        if ( match !== null ) {
            pageURL = pageURL.slice(match[0].length);
        }
    }

    if ( pageURL.startsWith(vAPI.getURL('main-blocked.html')) ) {
        let matches = /main-blocked\.html\?details=([^&]+)/.exec(pageURL);
        if ( matches && matches.length === 2 ) {
            try {
                let details = JSON.parse(atob(matches[1]));
                pageURL = details.url;
            } catch (e) {
            }
        }
    }

    let uri = this.URI.set(pageURL);
    let scheme = uri.scheme;
    if ( scheme === 'https' || scheme === 'http' ) {
        return uri.normalizedURI();
    }

    let fakeHostname = scheme + '-scheme';

    if ( uri.hostname !== '' ) {
        fakeHostname = uri.hostname + '.' + fakeHostname;
    } else if ( scheme === 'about' ) {
        fakeHostname = uri.path + '.' + fakeHostname;
    }

    return 'http://' + fakeHostname + '/';
};

µm.tabContextManager = (function() {
    let tabContexts = new Map();

    let urlToTabIds = {
        associations: new Map(),
        associate: function(tabId, url) {
            let tabIds = this.associations.get(url);
            if ( tabIds === undefined ) {
                this.associations.set(url, (tabIds = []));
            } else {
                let i = tabIds.indexOf(tabId);
                if ( i !== -1 ) {
                    tabIds.splice(i, 1);
                }
            }
            tabIds.push(tabId);
        },
        dissociate: function(tabId, url) {
            let tabIds = this.associations.get(url);
            if ( tabIds === undefined ) { return; }
            let i = tabIds.indexOf(tabId);
            if ( i !== -1 ) {
                tabIds.splice(i, 1);
            }
            if ( tabIds.length === 0 ) {
                this.associations.delete(url);
            }
        }
    };

    let mostRecentRootDocURL = '';
    let mostRecentRootDocURLTimestamp = 0;

    let gcPeriod = 31 * 60 * 1000;

    let StackEntry = function(url, commit) {
        this.url = url;
        this.committed = commit;
        this.tstamp = Date.now();
    };

    let TabContext = function(tabId) {
        this.tabId = tabId;
        this.stack = [];
        this.rawURL =
        this.normalURL =
        this.scheme =
        this.rootHostname =
        this.rootDomain = '';
        this.secure = false;
        this.commitTimer = null;
        this.gcTimer = null;

        tabContexts.set(tabId, this);
    };

    TabContext.prototype.destroy = function() {
        if ( vAPI.isBehindTheSceneTabId(this.tabId) ) { return; }
        if ( this.gcTimer !== null ) {
            clearTimeout(this.gcTimer);
            this.gcTimer = null;
        }
        urlToTabIds.dissociate(this.tabId, this.rawURL);
        tabContexts.delete(this.tabId);
    };

    TabContext.prototype.onTab = function(tab) {
        if ( tab ) {
            this.gcTimer = vAPI.setTimeout(this.onGC.bind(this), gcPeriod);
        } else {
            this.destroy();
        }
    };

    TabContext.prototype.onGC = function() {
        this.gcTimer = null;
        if ( vAPI.isBehindTheSceneTabId(this.tabId) ) { return; }
        vAPI.tabs.get(this.tabId, this.onTab.bind(this));
    };

    TabContext.prototype.onCommit = function() {
        if ( vAPI.isBehindTheSceneTabId(this.tabId) ) { return; }
        this.commitTimer = null;
        let i = this.stack.length;
        while ( i-- ) {
            if ( this.stack[i].committed ) {
                break;
            }
        }
        if ( i === -1 && this.stack.length !== 0 ) {
            this.stack[0].committed = true;
            i = 0;
        }
        i += 1;
        if ( i < this.stack.length ) {
            this.stack.length = i;
            this.update();
            µm.bindTabToPageStats(this.tabId, 'newURL');
        }
    };

    TabContext.prototype.autodestroy = function() {
        if ( vAPI.isBehindTheSceneTabId(this.tabId) ) { return; }
        this.gcTimer = vAPI.setTimeout(this.onGC.bind(this), gcPeriod);
    };

    TabContext.prototype.update = function() {
        urlToTabIds.dissociate(this.tabId, this.rawURL);
        if ( this.stack.length === 0 ) {
            this.rawURL = this.normalURL = this.scheme =
            this.rootHostname = this.rootDomain = '';
            this.secure = false;
            return;
        }
        this.rawURL = this.stack[this.stack.length - 1].url;
        this.normalURL = µm.normalizePageURL(this.tabId, this.rawURL);
        this.scheme = µm.URI.schemeFromURI(this.rawURL);
        this.rootHostname = µm.URI.hostnameFromURI(this.normalURL);
        this.rootDomain = µm.URI.domainFromHostname(this.rootHostname) || this.rootHostname;
        this.secure = µm.URI.isSecureScheme(this.scheme);
        urlToTabIds.associate(this.tabId, this.rawURL);
    };

    TabContext.prototype.push = function(url, context) {
        if ( vAPI.isBehindTheSceneTabId(this.tabId) ) { return; }
        let committed = context !== undefined;
        let count = this.stack.length;
        let topEntry = this.stack[count - 1];
        if ( topEntry && topEntry.url === url ) {
            if ( committed ) {
                topEntry.committed = true;
            }
            return;
        }
        if ( this.commitTimer !== null ) {
            clearTimeout(this.commitTimer);
        }
        if ( committed ) {
            this.stack = [new StackEntry(url, true)];
        } else {
            this.stack.push(new StackEntry(url));
            this.commitTimer = vAPI.setTimeout(this.onCommit.bind(this), 1000);
        }
        this.update();
        µm.bindTabToPageStats(this.tabId, context);
    };

    let push = function(tabId, url, context) {
        let entry = tabContexts.get(tabId);
        if ( entry === undefined ) {
            entry = new TabContext(tabId);
            entry.autodestroy();
        }
        entry.push(url, context);
        mostRecentRootDocURL = url;
        mostRecentRootDocURLTimestamp = Date.now();
        return entry;
    };

    let mustLookup = function(tabId, url) {
        let entry;
        if ( url !== undefined ) {
            entry = push(tabId, url);
        } else {
            entry = tabContexts.get(tabId);
        }
        if ( entry !== undefined ) {
            return entry;
        }
        if ( mostRecentRootDocURL !== '' && mostRecentRootDocURLTimestamp + 500 < Date.now() ) {
            mostRecentRootDocURL = '';
        }
        if ( mostRecentRootDocURL !== '' ) {
            return push(tabId, mostRecentRootDocURL);
        }
        return tabContexts.get(vAPI.noTabId);
    };

    let lookup = function(tabId) {
        return tabContexts.get(tabId) || null;
    };

    let tabIdFromURL = function(url) {
        let tabIds = urlToTabIds.associations.get(url);
        if ( tabIds === undefined ) { return -1; }
        return tabIds[tabIds.length - 1];
    };

    (function() {
        let entry = new TabContext(vAPI.noTabId);
        entry.stack.push(new StackEntry('', true));
        entry.rawURL = '';
        entry.normalURL = µm.normalizePageURL(entry.tabId);
        entry.rootHostname = µm.URI.hostnameFromURI(entry.normalURL);
        entry.rootDomain = µm.URI.domainFromHostname(entry.rootHostname) || entry.rootHostname;
    })();

    vAPI.tabs.onNavigation = function(details) {
        let tabId = details.tabId;
        if ( vAPI.isBehindTheSceneTabId(tabId) ) { return; }
        push(tabId, details.url, 'newURL');
        µm.updateBadgeAsync(tabId);
    };

    vAPI.tabs.onUpdated = function(tabId, changeInfo, tab) {
        if ( vAPI.isBehindTheSceneTabId(tabId) ) { return; }
        if ( typeof tab.url !== 'string' || tab.url === '' ) { return; }
        let url = changeInfo.url || tab.url;
        if ( url ) {
            push(tabId, url, 'updateURL');
        }
    };

    vAPI.tabs.onClosed = function(tabId) {
        µm.unbindTabFromPageStats(tabId);
        let entry = tabContexts.get(tabId);
        if ( entry instanceof TabContext ) {
            entry.destroy();
        }
    };

    return {
        push: push,
        lookup: lookup,
        mustLookup: mustLookup,
        tabIdFromURL: tabIdFromURL
    };
})();

vAPI.tabs.registerListeners();

µm.bindTabToPageStats = function(tabId, context) {
    this.updateBadgeAsync(tabId);

    let tabContext = this.tabContextManager.lookup(tabId);
    if ( tabContext === null ) { return; }

    if ( vAPI.isBehindTheSceneTabId(tabId) ) {
        return this.pageStores.get(tabId);
    }

    let normalURL = tabContext.normalURL;
    let pageStore = this.pageStores.get(tabId);

    if ( pageStore !== undefined ) {
        if ( pageStore.pageUrl === normalURL ) {
            return pageStore;
        }

        if (
            context === 'updateURL' &&
            pageStore.pageHostname === tabContext.rootHostname
        ) {
            pageStore.rawURL = tabContext.rawURL;
            pageStore.pageUrl = normalURL;
            this.updateTitle(tabId);
            this.pageStoresToken = Date.now();
            return pageStore;
        }

        this.unbindTabFromPageStats(tabId);
    }

    pageStore = this.resurrectPageStore(tabId, normalURL);
    if ( pageStore === null ) {
        pageStore = this.pageStoreFactory(tabContext);
    }
    this.pageStores.set(tabId, pageStore);
    this.updateTitle(tabId);
    this.pageStoresToken = Date.now();

    return pageStore;
};

µm.unbindTabFromPageStats = function(tabId) {
    if ( vAPI.isBehindTheSceneTabId(tabId) ) { return; }

    let pageStore = this.pageStores.get(tabId);
    if ( pageStore === undefined ) { return; }

    this.pageStores.delete(tabId);
    this.pageStoresToken = Date.now();

    if ( pageStore.incinerationTimer ) {
        clearTimeout(pageStore.incinerationTimer);
        pageStore.incinerationTimer = null;
    }

    let pageStoreCrypt = this.pageStoreCemetery.get(tabId);
    if ( pageStoreCrypt === undefined ) {
        this.pageStoreCemetery.set(tabId, (pageStoreCrypt = new Map()));
    }

    let pageURL = pageStore.pageUrl;
    pageStoreCrypt.set(pageURL, pageStore);

    pageStore.incinerationTimer = vAPI.setTimeout(
        this.incineratePageStore.bind(this, tabId, pageURL),
        4 * 60 * 1000
    );
};

µm.resurrectPageStore = function(tabId, pageURL) {
    let pageStoreCrypt = this.pageStoreCemetery.get(tabId);
    if ( pageStoreCrypt === undefined ) { return null; }

    let pageStore = pageStoreCrypt.get(pageURL);
    if ( pageStore === undefined ) { return null; }

    if ( pageStore.incinerationTimer !== null ) {
        clearTimeout(pageStore.incinerationTimer);
        pageStore.incinerationTimer = null;
    }

    pageStoreCrypt.delete(pageURL);
    if ( pageStoreCrypt.size === 0 ) {
        this.pageStoreCemetery.delete(tabId);
    }

    return pageStore;
};

µm.incineratePageStore = function(tabId, pageURL) {
    let pageStoreCrypt = this.pageStoreCemetery.get(tabId);
    if ( pageStoreCrypt === undefined ) { return; }

    let pageStore = pageStoreCrypt.get(pageURL);
    if ( pageStore === undefined ) { return; }

    if ( pageStore.incinerationTimer !== null ) {
        clearTimeout(pageStore.incinerationTimer);
        pageStore.incinerationTimer = null;
    }

    pageStoreCrypt.delete(pageURL);
    if ( pageStoreCrypt.size === 0 ) {
        this.pageStoreCemetery.delete(tabId);
    }

    pageStore.dispose();
};

µm.pageStoreFromTabId = function(tabId) {
    return this.pageStores.get(tabId) || null;
};

µm.mustPageStoreFromTabId = function(tabId) {
    return this.pageStores.get(tabId) || this.pageStores.get(vAPI.noTabId);
};

µm.forceReload = function(tabId, bypassCache) {
    vAPI.tabs.reload(tabId, bypassCache);
};

µm.updateBadgeAsync = (function() {
    let tabIdToTimer = new Map();

    let updateBadge = function(tabId) {
        tabIdToTimer.delete(tabId);

        let iconId = 'off';
        let badgeStr = '';

        let pageStore = this.pageStoreFromTabId(tabId);
        if ( pageStore !== null ) {
            let total = pageStore.perLoadAllowedRequestCount +
                        pageStore.perLoadBlockedRequestCount;
            if ( total ) {
                let squareSize = 19;
                let greenSize = squareSize * Math.sqrt(
                    pageStore.perLoadAllowedRequestCount / total
                );
                iconId = greenSize < squareSize/2 ?
                    Math.ceil(greenSize) :
                    Math.floor(greenSize);
            }
            if (
                this.userSettings.iconBadgeEnabled &&
                pageStore.perLoadBlockedRequestCount !== 0
            ) {
                badgeStr = this.formatCount(pageStore.perLoadBlockedRequestCount);
            }
        }

        vAPI.setIcon(
            tabId,
            'img/browsericons/icon19-' + iconId + '.png',
            { text: badgeStr, color: '#666' }
        );
    };

    return function(tabId) {
        if ( tabIdToTimer.has(tabId) ) { return; }
        if ( vAPI.isBehindTheSceneTabId(tabId) ) { return; }
        tabIdToTimer.set(
            tabId,
            vAPI.setTimeout(updateBadge.bind(this, tabId), 750)
        );
    };
})();

µm.updateTitle = (function() {
    let tabIdToTimer = new Map();
    let tabIdToTryCount = new Map();
    let delay = 499;

    let tryNoMore = function(tabId) {
        tabIdToTryCount.delete(tabId);
    };

    let tryAgain = function(tabId) {
        let count = tabIdToTryCount.get(tabId);
        if ( count === undefined ) { return false; }
        if ( count === 1 ) {
            tabIdToTryCount.delete(tabId);
            return false;
        }
        tabIdToTryCount.set(tabId, count - 1);
        tabIdToTimer.set(
            tabId,
            vAPI.setTimeout(updateTitle.bind(µm, tabId), delay)
        );
        return true;
    };

    var onTabReady = function(tabId, tab) {
        if ( !tab ) {
            return tryNoMore(tabId);
        }
        var pageStore = this.pageStoreFromTabId(tabId);
        if ( pageStore === null ) {
            return tryNoMore(tabId);
        }
        if ( !tab.title && tryAgain(tabId) ) {
            return;
        }
        var settled = tab.title && tab.title === pageStore.title;
        pageStore.title = tab.title || tab.url || '';
        this.pageStoresToken = Date.now();
        if ( settled || !tryAgain(tabId) ) {
            tryNoMore(tabId);
        }
    };

    var updateTitle = function(tabId) {
        tabIdToTimer.delete(tabId);
        vAPI.tabs.get(tabId, onTabReady.bind(this, tabId));
    };

    return function(tabId) {
        if ( vAPI.isBehindTheSceneTabId(tabId) ) { return; }
        let timer = tabIdToTimer.get(tabId);
        if ( timer !== undefined ) {
            clearTimeout(timer);
        }
        tabIdToTimer.set(
            tabId,
            vAPI.setTimeout(updateTitle.bind(this, tabId), delay)
        );
        tabIdToTryCount.set(tabId, 5);
    };
})();

(function() {
    var cleanupPeriod = 7 * 60 * 1000;
    var cleanupSampleAt = 0;
    var cleanupSampleSize = 11;

    var cleanup = function() {
        var vapiTabs = vAPI.tabs;
        var tabIds = Array.from(µm.pageStores.keys()).sort();
        var checkTab = function(tabId) {
            vapiTabs.get(tabId, function(tab) {
                if ( !tab ) {
                    µm.unbindTabFromPageStats(tabId);
                }
            });
        };
        if ( cleanupSampleAt >= tabIds.length ) {
            cleanupSampleAt = 0;
        }
        var tabId;
        var n = Math.min(cleanupSampleAt + cleanupSampleSize, tabIds.length);
        for ( var i = cleanupSampleAt; i < n; i++ ) {
            tabId = tabIds[i];
            if ( vAPI.isBehindTheSceneTabId(tabId) ) { continue; }
            checkTab(tabId);
        }
        cleanupSampleAt = n;

        vAPI.setTimeout(cleanup, cleanupPeriod);
    };

    vAPI.setTimeout(cleanup, cleanupPeriod);
})();

})();
