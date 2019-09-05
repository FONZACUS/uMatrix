(function() {
'use strict';

var µm = µMatrix;

var processCallbackQueue = function(queue, callback) {
    var processOne = function() {
        var fn = queue.pop();
        if ( fn ) {
            fn(processOne);
        } else if ( typeof callback === 'function' ) {
            callback();
        }
    };
    processOne();
};

var onAllDone = function() {
    µm.webRequest.start();

    µm.loadRecipes();

    µm.assets.addObserver(µm.assetObserver.bind(µm));
    µm.scheduleAssetUpdater(µm.userSettings.autoUpdate ? 7 * 60 * 1000 : 0);

    vAPI.cloud.start([ 'myRulesPane' ]);
};

var onPSLReady = function() {
    let count = 4;
    const countdown = ( ) => {
        count -= 1;
        if ( count !== 0 ) { return; }
        onAllDone();
    };

    µm.loadRawSettings(countdown);
    µm.loadMatrix(countdown);
    µm.loadHostsFiles(countdown);

    vAPI.tabs.getAll(tabs => {
        const pageStore =
            µm.pageStoreFactory(µm.tabContextManager.mustLookup(vAPI.noTabId));
        pageStore.title = vAPI.i18n('statsPageDetailedBehindTheScenePage');
        µm.pageStores.set(vAPI.noTabId, pageStore);

        if ( Array.isArray(tabs) ) {
            for ( const tab of tabs ) {
                µm.tabContextManager.push(tab.id, tab.url, 'newURL');
            }
        }
        countdown();
    });
};

processCallbackQueue(µm.onBeforeStartQueue, function() {
    let count = 2;
    const countdown = ( ) => {
        count -= 1;
        if ( count !== 0 ) { return; }
        onPSLReady();
    };

    µm.publicSuffixList.load(countdown);
    µm.loadUserSettings(countdown);
});

})();
