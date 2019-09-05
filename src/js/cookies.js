"use strict";

µMatrix.cookieHunter = (function() {
var µm = µMatrix;

var recordPageCookiesQueue = new Map();
var removeCookieQueue = new Set();
var cookieDict = new Map();
var cookieEntryJunkyard = [];
var processRemoveQueuePeriod = 2 * 60 * 1000;
var processCleanPeriod = 10 * 60 * 1000;
var processPageRecordQueueTimer = null;

var CookieEntry = function(cookie) {
    this.usedOn = new Set();
    this.init(cookie);
};

CookieEntry.prototype.init = function(cookie) {
    this.secure = cookie.secure;
    this.session = cookie.session;
    this.anySubdomain = cookie.domain.charAt(0) === '.';
    this.hostname = this.anySubdomain ? cookie.domain.slice(1) : cookie.domain;
    this.domain = µm.URI.domainFromHostname(this.hostname) || this.hostname;
    this.path = cookie.path;
    this.name = cookie.name;
    this.value = cookie.value;
    this.tstamp = Date.now();
    this.usedOn.clear();
    return this;
};

CookieEntry.prototype.dispose = function() {
    this.hostname = '';
    this.domain = '';
    this.path = '';
    this.name = '';
    this.value = '';
    this.usedOn.clear();
    return this;
};

var addCookieToDict = function(cookie) {
    var cookieKey = cookieKeyFromCookie(cookie),
        cookieEntry = cookieDict.get(cookieKey);
    if ( cookieEntry === undefined ) {
        cookieEntry = cookieEntryJunkyard.pop();
        if ( cookieEntry ) {
            cookieEntry.init(cookie);
        } else {
            cookieEntry = new CookieEntry(cookie);
        }
        cookieDict.set(cookieKey, cookieEntry);
    }
    return cookieEntry;
};

var addCookiesToDict = function(cookies) {
    var i = cookies.length;
    while ( i-- ) {
        addCookieToDict(cookies[i]);
    }
};

var removeCookieFromDict = function(cookieKey) {
    var cookieEntry = cookieDict.get(cookieKey);
    if ( cookieEntry === undefined ) { return false; }
    cookieDict.delete(cookieKey);
    if ( cookieEntryJunkyard.length < 25 ) {
        cookieEntryJunkyard.push(cookieEntry.dispose());
    }
    return true;
};

var cookieKeyBuilder = [
    '',
    '://',
    '',
    '',
    '{',
    '',
    '-cookie:',
    '',
    '}'
];

var cookieKeyFromCookie = function(cookie) {
    var cb = cookieKeyBuilder;
    cb[0] = cookie.secure ? 'https' : 'http';
    cb[2] = cookie.domain.charAt(0) === '.' ? cookie.domain.slice(1) : cookie.domain;
    cb[3] = cookie.path;
    cb[5] = cookie.session ? 'session' : 'persistent';
    cb[7] = cookie.name;
    return cb.join('');
};

var cookieKeyFromCookieURL = function(url, type, name) {
    var µmuri = µm.URI.set(url);
    var cb = cookieKeyBuilder;
    cb[0] = µmuri.scheme;
    cb[2] = µmuri.hostname;
    cb[3] = µmuri.path;
    cb[5] = type;
    cb[7] = name;
    return cb.join('');
};

var cookieURLFromCookieEntry = function(entry) {
    if ( !entry ) {
        return '';
    }
    return (entry.secure ? 'https://' : 'http://') + entry.hostname + entry.path;
};

var cookieMatchDomains = function(cookieKey, allHostnamesString) {
    var cookieEntry = cookieDict.get(cookieKey);
    if ( cookieEntry === undefined ) { return false; }
    if ( allHostnamesString.indexOf(' ' + cookieEntry.hostname + ' ') < 0 ) {
        if ( !cookieEntry.anySubdomain ) {
            return false;
        }
        if ( allHostnamesString.indexOf('.' + cookieEntry.hostname + ' ') < 0 ) {
            return false;
        }
    }
    return true;
};

var recordPageCookiesAsync = function(pageStore) {
    if ( !pageStore ) { return; }
    recordPageCookiesQueue.set(pageStore.pageUrl, pageStore);
    if ( processPageRecordQueueTimer !== null ) { return; }
    processPageRecordQueueTimer = vAPI.setTimeout(processPageRecordQueue, 1000);
};

var recordPageCookie = (function() {
    let queue = new Map();
    let queueTimer;
    let cookieLogEntryBuilder = [ '', '{', '', '-cookie:', '', '}' ];

    let process = function() {
        queueTimer = undefined;
        for ( let qentry of queue ) {
            let pageStore = qentry[0];
            if ( pageStore.tabId === '' ) { continue; }
            for ( let cookieKey of qentry[1] ) {
                let cookieEntry = cookieDict.get(cookieKey);
                if ( cookieEntry === undefined ) { continue; }
                let blocked = µm.mustBlock(
                    pageStore.pageHostname,
                    cookieEntry.hostname,
                    'cookie'
                );
                cookieLogEntryBuilder[0] =
                    cookieURLFromCookieEntry(cookieEntry);
                cookieLogEntryBuilder[2] =
                    cookieEntry.session ? 'session' : 'persistent';
                cookieLogEntryBuilder[4] =
                    encodeURIComponent(cookieEntry.name);
                let cookieURL = cookieLogEntryBuilder.join('');
                pageStore.recordRequest('cookie', cookieURL, blocked);
                µm.logger.writeOne({
                    tabId: pageStore.tabId,
                    srcHn: pageStore.pageHostname,
                    desHn: cookieEntry.hostname,
                    desURL: cookieURL,
                    type: 'cookie',
                    blocked
                });
                cookieEntry.usedOn.add(pageStore.pageHostname);
                if ( !blocked ) { continue; }
                if ( µm.userSettings.deleteCookies ) {
                    removeCookieAsync(cookieKey);
                }
                µm.updateBadgeAsync(pageStore.tabId);
            }
        }
        queue.clear();
    };

    return function(pageStore, cookieKey) {
        if ( vAPI.isBehindTheSceneTabId(pageStore.tabId) ) { return; }
        let entry = queue.get(pageStore);
        if ( entry === undefined ) {
            queue.set(pageStore, (entry = new Set()));
        }
        if ( entry.has(cookieKey) ) { return; }
        entry.add(cookieKey);
        if ( queueTimer === undefined ) {
            queueTimer = vAPI.setTimeout(process, 277);
        }
    };
})();

var removeCookieAsync = function(cookieKey) {
    removeCookieQueue.add(cookieKey);
};

var chromeCookieRemove = function(cookieEntry, name) {
    var url = cookieURLFromCookieEntry(cookieEntry);
    if ( url === '' ) { return; }

    var sessionCookieKey = cookieKeyFromCookieURL(url, 'session', name);
    var persistCookieKey = cookieKeyFromCookieURL(url, 'persistent', name);
    var callback = function(details) {
        var success = !!details;
        var template = success ? i18nCookieDeleteSuccess : i18nCookieDeleteFailure;
        if ( removeCookieFromDict(sessionCookieKey) ) {
            if ( success ) {
                µm.cookieRemovedCounter += 1;
            }
            µm.logger.writeOne({
                info: template.replace('{{value}}', sessionCookieKey)
            });
        }
        if ( removeCookieFromDict(persistCookieKey) ) {
            if ( success ) {
                µm.cookieRemovedCounter += 1;
            }
            µm.logger.writeOne({
                info: template.replace('{{value}}', persistCookieKey)
            });
        }
    };

    vAPI.cookies.remove({ url: url, name: name }, callback);
};

var i18nCookieDeleteSuccess = vAPI.i18n('loggerEntryCookieDeleted');
var i18nCookieDeleteFailure = vAPI.i18n('loggerEntryDeleteCookieError');

var processPageRecordQueue = function() {
    processPageRecordQueueTimer = null;

    for ( var pageStore of recordPageCookiesQueue.values() ) {
        findAndRecordPageCookies(pageStore);
    }
    recordPageCookiesQueue.clear();
};

var processRemoveQueue = function() {
    var userSettings = µm.userSettings;
    var deleteCookies = userSettings.deleteCookies;

    var tstampObsolete = userSettings.deleteUnusedSessionCookies ?
        Date.now() - userSettings.deleteUnusedSessionCookiesAfter * 60 * 1000 :
        0;

    var srcHostnames;
    var cookieEntry;

    for ( var cookieKey of removeCookieQueue ) {
        cookieEntry = cookieDict.get(cookieKey);
        if ( cookieEntry === undefined ) { continue; }

        if ( tstampObsolete !== 0 && cookieEntry.session ) {
            if ( cookieEntry.tstamp < tstampObsolete ) {
                chromeCookieRemove(cookieEntry, cookieEntry.name);
                continue;
            }
        }

        if ( deleteCookies === false ) {
            continue;
        }

        if ( srcHostnames === undefined ) {
            srcHostnames = µm.tMatrix.extractAllSourceHostnames();
        }

        if ( canRemoveCookie(cookieKey, srcHostnames) ) {
            chromeCookieRemove(cookieEntry, cookieEntry.name);
        }
    }

    removeCookieQueue.clear();

    vAPI.setTimeout(processRemoveQueue, processRemoveQueuePeriod);
};

var processClean = function() {
    var us = µm.userSettings;
    if ( us.deleteCookies || us.deleteUnusedSessionCookies ) {
        var cookieKeys = Array.from(cookieDict.keys()),
            len = cookieKeys.length,
            step, offset, n;
        if ( len > 25 ) {
            step = len / 25;
            offset = Math.floor(Math.random() * len);
            n = 25;
        } else {
            step = 1;
            offset = 0;
            n = len;
        }
        var i = offset;
        while ( n-- ) {
            removeCookieAsync(cookieKeys[Math.floor(i % len)]);
            i += step;
        }
    }

    vAPI.setTimeout(processClean, processCleanPeriod);
};

var findAndRecordPageCookies = function(pageStore) {
    for ( var cookieKey of cookieDict.keys() ) {
        if ( cookieMatchDomains(cookieKey, pageStore.allHostnamesString) ) {
            recordPageCookie(pageStore, cookieKey);
        }
    }
};

var canRemoveCookie = function(cookieKey, srcHostnames) {
    var cookieEntry = cookieDict.get(cookieKey);
    if ( cookieEntry === undefined ) { return false; }

    var cookieHostname = cookieEntry.hostname;
    var srcHostname;

    for ( srcHostname of cookieEntry.usedOn ) {
        if ( µm.mustAllow(srcHostname, cookieHostname, 'cookie') ) {
            return false;
        }
    }
    srcHostname = cookieHostname;
    var pos;
    for (;;) {
        if ( srcHostnames.has(srcHostname) ) {
            if ( µm.mustAllow(srcHostname, cookieHostname, 'cookie') ) {
                return false;
            }
        }
        if ( srcHostname === cookieEntry.domain ) {
            break;
        }
        pos = srcHostname.indexOf('.');
        if ( pos === -1 ) {
            break;
        }
        srcHostname = srcHostname.slice(pos + 1);
    }
    return true;
};

vAPI.cookies.onChanged = (function() {
    let queue = new Map();
    let queueTimer;

    let process = function() {
        queueTimer = undefined;
        let now = Date.now();
        let cookieKeys = [];
        for ( let qentry of queue ) {
            if ( qentry[1] > now ) { continue; }
            if ( cookieDict.has(qentry[0]) === false ) { continue; }
            cookieKeys.push(qentry[0]);
            queue.delete(qentry[0]);
        }
        if ( cookieKeys.length !== 0 ) {
            for ( let pageStore of µm.pageStores.values() ) {
                let allHostnamesString = pageStore.allHostnamesString;
                for ( let cookieKey of cookieKeys ) {
                    if ( cookieMatchDomains(cookieKey, allHostnamesString) ) {
                        recordPageCookie(pageStore, cookieKey);
                    }
                }
            }
        }
        if ( queue.size !== 0 ) {
            queueTimer = vAPI.setTimeout(process, 797);
        }
    };

    return function(cookie) {
        let cookieKey = cookieKeyFromCookie(cookie);
        let cookieEntry = cookieDict.get(cookieKey);
        if ( cookieEntry === undefined ) {
            cookieEntry = addCookieToDict(cookie);
        } else {
            cookieEntry.tstamp = Date.now();
            if ( cookie.value === cookieEntry.value ) { return; }
            cookieEntry.value = cookie.value;
        }
        if ( queue.has(cookieKey) ) { return; }
        queue.set(cookieKey, Date.now() + 653);
        if ( queueTimer === undefined ) {
            queueTimer = vAPI.setTimeout(process, 727);
        }
    };
})();

vAPI.cookies.onRemoved = function(cookie) {
    var cookieKey = cookieKeyFromCookie(cookie);
    if ( removeCookieFromDict(cookieKey) ) {
        µm.logger.writeOne({
            info: i18nCookieDeleteSuccess.replace('{{value}}', cookieKey),
            prettify: 'cookie'
        });
    }
};

vAPI.cookies.onAllRemoved = function() {
    for ( var cookieKey of cookieDict.keys() ) {
        if ( removeCookieFromDict(cookieKey) ) {
            µm.logger.writeOne({
                info: i18nCookieDeleteSuccess.replace('{{value}}', cookieKey),
                prettify: 'cookie'
            });
        }
    }
};

vAPI.cookies.getAll(addCookiesToDict);
vAPI.cookies.start();

vAPI.setTimeout(processRemoveQueue, processRemoveQueuePeriod);
vAPI.setTimeout(processClean, processCleanPeriod);

return {
    recordPageCookies: recordPageCookiesAsync
};

})();
