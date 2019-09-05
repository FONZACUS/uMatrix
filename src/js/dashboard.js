'use strict';

(function() {
    var loadDashboardPanel = function(hash) {
        var button = uDom(hash);
        var url = button.attr('data-dashboard-panel-url');
        uDom('iframe').attr('src', url);
        uDom('.tabButton').forEach(function(button){
            button.toggleClass(
                'selected',
                button.attr('data-dashboard-panel-url') === url
            );
        });
    };

    var onTabClickHandler = function() {
        loadDashboardPanel(window.location.hash);
    };

    uDom.onLoad(function() {
        window.addEventListener('hashchange', onTabClickHandler);
        var hash = window.location.hash;
        if ( hash.length < 2 ) {
            hash = '#settings';
        }
        loadDashboardPanel(hash);
    });

})();
