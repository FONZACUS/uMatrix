'use strict';

(function() {
    var onAssetContentReceived = function(details) {
        document.getElementById('content').textContent =
            details && (details.content || '');
    };

    var q = window.location.search;
    var matches = q.match(/^\?url=([^&]+)/);
    if ( !matches || matches.length !== 2 ) {
        return;
    }

    vAPI.messaging.send(
        'asset-viewer.js',
        { what : 'getAssetContent', url: matches[1] },
        onAssetContentReceived
    );

})();
