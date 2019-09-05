'use strict';

if ( self.browser instanceof Object ) {
    self.chrome = self.browser;
} else {
    self.browser = self.chrome;
}

(function(self) {
if ( self.vAPI === undefined || self.vAPI.uMatrix !== true ) {
    self.vAPI = { uMatrix: true };
}

var vAPI = self.vAPI;
var chrome = self.chrome;

vAPI.setTimeout = vAPI.setTimeout || window.setTimeout.bind(window);

vAPI.webextFlavor = {
    major: 0,
    soup: new Set()
};

(function() {
    var ua = navigator.userAgent,
        flavor = vAPI.webextFlavor,
        soup = flavor.soup;
    var dispatch = function() {
        window.dispatchEvent(new CustomEvent('webextFlavor'));
    };

    soup.add('ublock');

    if ( /\bMobile\b/.test(ua) ) {
        soup.add('mobile');
    }

    var async = self.browser instanceof Object &&
                typeof self.browser.runtime.getBrowserInfo === 'function';
    if ( async ) {
        self.browser.runtime.getBrowserInfo().then(function(info) {
            flavor.major = parseInt(info.version, 10) || 0;
            soup.add(info.vendor.toLowerCase())
                .add(info.name.toLowerCase());
            if ( flavor.major >= 53 ) { soup.add('user_stylesheet'); }
            if ( flavor.major >= 57 ) { soup.add('html_filtering'); }
            dispatch();
        });
    }

    var match = /Firefox\/([\d.]+)/.exec(ua);
    if ( match !== null ) {
        flavor.major = parseInt(match[1], 10) || 0;
        soup.add('mozilla')
            .add('firefox');
        if ( flavor.major >= 53 ) { soup.add('user_stylesheet'); }
        if ( flavor.major >= 57 ) { soup.add('html_filtering'); }
    } else {
        match = /OPR\/([\d.]+)/.exec(ua);
        if ( match !== null ) {
            var reEx = /Chrom(?:e|ium)\/([\d.]+)/;
            if ( reEx.test(ua) ) { match = reEx.exec(ua); }
            flavor.major = parseInt(match[1], 10) || 0;
            soup.add('opera').add('chromium');
        } else {
            match = /Chromium\/([\d.]+)/.exec(ua);
            if ( match !== null ) {
                flavor.major = parseInt(match[1], 10) || 0;
                soup.add('chromium');
            } else {
                match = /Chrome\/([\d.]+)/.exec(ua);
                if ( match !== null ) {
                    flavor.major = parseInt(match[1], 10) || 0;
                    soup.add('google').add('chromium');
                }
            }
        }
        if ( soup.has('chromium') && flavor.major >= 67 ) {
            soup.add('user_stylesheet');
        }
    }

    if ( !async ) {
        vAPI.setTimeout(dispatch, 97);
    }
})();

var setScriptDirection = function(language) {
    document.body.setAttribute(
        'dir',
        ['ar', 'he', 'fa', 'ps', 'ur'].indexOf(language) !== -1 ? 'rtl' : 'ltr'
    );
};

vAPI.download = function(details) {
    if ( !details.url ) {
        return;
    }

    var a = document.createElement('a');
    a.href = details.url;
    a.setAttribute('download', details.filename || '');
    a.dispatchEvent(new MouseEvent('click'));
};

vAPI.getURL = chrome.runtime.getURL;

vAPI.i18n = chrome.i18n.getMessage;

setScriptDirection(vAPI.i18n('@@ui_locale'));

vAPI.closePopup = function() {
    window.close();
};

vAPI.localStorage = {
    clear: function() {
        try {
            window.localStorage.clear();
        } catch(ex) {
        }
    },
    getItem: function(key) {
        try {
            return window.localStorage.getItem(key);
        } catch(ex) {
        }
        return null;
    },
    removeItem: function(key) {
        try {
            window.localStorage.removeItem(key);
        } catch(ex) {
        }
    },
    setItem: function(key, value) {
        try {
            window.localStorage.setItem(key, value);
        } catch(ex) {
        }
    }
};

})(this);
