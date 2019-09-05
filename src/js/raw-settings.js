'use strict';

(function() {
var messaging = vAPI.messaging;
var cachedData = '';
var rawSettingsInput = uDom.nodeFromId('rawSettings');

var hashFromRawSettings = function(raw) {
    return raw.trim().replace(/\s+/g, '|');
};

var rawSettingsChanged = (function () {
    var timer = null;

    var handler = function() {
        timer = null;
        var changed =
            hashFromRawSettings(rawSettingsInput.value) !== cachedData;
        uDom.nodeFromId('rawSettingsApply').disabled = !changed;
    };

    return function() {
        if ( timer !== null ) {
            clearTimeout(timer);
        }
        timer = vAPI.setTimeout(handler, 100);
    };
})();

function renderRawSettings() {
    var onRead = function(raw) {
        cachedData = hashFromRawSettings(raw);
        var pretty = [],
            whitespaces = '                                ',
            lines = raw.split('\n'),
            max = 0,
            pos,
            i, n = lines.length;
        for ( i = 0; i < n; i++ ) {
            pos = lines[i].indexOf(' ');
            if ( pos > max ) {
                max = pos;
            }
        }
        for ( i = 0; i < n; i++ ) {
            pos = lines[i].indexOf(' ');
            pretty.push(whitespaces.slice(0, max - pos) + lines[i]);
        }
        rawSettingsInput.value = pretty.join('\n') + '\n';
        rawSettingsChanged();
        rawSettingsInput.focus();
    };
    messaging.send('dashboard', { what: 'readRawSettings' }, onRead);
}

var applyChanges = function() {
    messaging.send(
        'dashboard',
        {
            what: 'writeRawSettings',
            content: rawSettingsInput.value
        },
        renderRawSettings
    );
};

uDom('#rawSettings').on('input', rawSettingsChanged);
uDom('#rawSettingsApply').on('click', applyChanges);

renderRawSettings();

})();
