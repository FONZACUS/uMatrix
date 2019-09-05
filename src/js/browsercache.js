'use strict';

(function() {
var clearCache = function() {
    vAPI.setTimeout(clearCache, 15 * 60 * 1000);

    var µm = µMatrix;
    if ( !µm.userSettings.clearBrowserCache ) {
        return;
    }

    µm.clearBrowserCacheCycle -= 15;
    if ( µm.clearBrowserCacheCycle > 0 ) {
        return;
    }

    vAPI.browserData.clearCache();

    µm.clearBrowserCacheCycle = µm.userSettings.clearBrowserCacheAfter;
    µm.browserCacheClearedCounter++;

    µm.logger.writeOne({ info: vAPI.i18n('loggerEntryBrowserCacheCleared') });

};

vAPI.setTimeout(clearCache, 15 * 60 * 1000);

})();
