'use strict';

(function() {
var cachedSettings = {};

function changeUserSettings(name, value) {
    vAPI.messaging.send('settings.js', {
        what: 'userSettings',
        name: name,
        value: value
    });
}

function changeMatrixSwitch(name, state) {
    vAPI.messaging.send('settings.js', {
        what: 'setMatrixSwitch',
        switchName: name,
        state: state
    });
}

function onChangeValueHandler(elem, setting, min, max) {
    var oldVal = cachedSettings.userSettings[setting];
    var newVal = Math.round(parseFloat(elem.value));
    if ( typeof newVal !== 'number' ) {
        newVal = oldVal;
    } else {
        newVal = Math.max(newVal, min);
        newVal = Math.min(newVal, max);
    }
    elem.value = newVal;
    if ( newVal !== oldVal ) {
        changeUserSettings(setting, newVal);
    }
}

function prepareToDie() {
    onChangeValueHandler(
        uDom.nodeFromId('deleteUnusedSessionCookiesAfter'),
        'deleteUnusedSessionCookiesAfter',
        15, 1440
    );
    onChangeValueHandler(
        uDom.nodeFromId('clearBrowserCacheAfter'),
        'clearBrowserCacheAfter',
        15, 1440
    );
}

function onInputChanged(ev) {
    var target = ev.target;

    switch ( target.id ) {
    case 'displayTextSize':
        changeUserSettings('displayTextSize', target.value + 'px');
        break;
    case 'clearBrowserCache':
    case 'cloudStorageEnabled':
    case 'collapseBlacklisted':
    case 'collapseBlocked':
    case 'colorBlindFriendly':
    case 'deleteCookies':
    case 'deleteLocalStorage':
    case 'deleteUnusedSessionCookies':
    case 'iconBadgeEnabled':
    case 'noTooltips':
    case 'processHyperlinkAuditing':
        changeUserSettings(target.id, target.checked);
        break;
    case 'noMixedContent':
    case 'noscriptTagsSpoofed':
    case 'processReferer':
        changeMatrixSwitch(
            target.getAttribute('data-matrix-switch'),
            target.checked
        );
        break;
    case 'deleteUnusedSessionCookiesAfter':
        onChangeValueHandler(target, 'deleteUnusedSessionCookiesAfter', 15, 1440);
        break;
    case 'clearBrowserCacheAfter':
        onChangeValueHandler(target, 'clearBrowserCacheAfter', 15, 1440);
        break;
    case 'popupScopeLevel':
        changeUserSettings('popupScopeLevel', target.value);
        break;
    default:
        break;
    }

    switch ( target.id ) {
    case 'collapseBlocked':
        synchronizeWidgets();
        break;
    default:
        break;
    }
}

function synchronizeWidgets() {
    var e1, e2;

    e1 = uDom.nodeFromId('collapseBlocked');
    e2 = uDom.nodeFromId('collapseBlacklisted');
    if ( e1.checked ) {
        e2.setAttribute('disabled', '');
    } else {
        e2.removeAttribute('disabled');
    }
}

vAPI.messaging.send(
    'settings.js',
    { what: 'getUserSettings' },
    function onSettingsReceived(settings) {
        cachedSettings = settings;

        var userSettings = settings.userSettings;
        var matrixSwitches = settings.matrixSwitches;

        uDom('[data-setting-bool]').forEach(function(elem){
            elem.prop('checked', userSettings[elem.prop('id')] === true);
        });

        uDom('[data-matrix-switch]').forEach(function(elem){
            var switchName = elem.attr('data-matrix-switch');
            if ( typeof switchName === 'string' && switchName !== '' ) {
                elem.prop('checked', matrixSwitches[switchName] === true);
            }
        });

        uDom.nodeFromId('displayTextSize').value =
            parseInt(userSettings.displayTextSize, 10) || 14;

        uDom.nodeFromId('popupScopeLevel').value = userSettings.popupScopeLevel;
        uDom.nodeFromId('deleteUnusedSessionCookiesAfter').value =
            userSettings.deleteUnusedSessionCookiesAfter;
        uDom.nodeFromId('clearBrowserCacheAfter').value =
            userSettings.clearBrowserCacheAfter;

        synchronizeWidgets();

        document.addEventListener('change', onInputChanged);

        uDom(window).on('beforeunload', prepareToDie);
    }
);

})();
